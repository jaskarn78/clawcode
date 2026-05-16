/**
 * scripts/homelab/__tests__/verify.test.ts
 *
 * Phase 999.47 Plan 03 Task 2 — vitest spec for verify.sh.
 *
 * Shells out to `bash verify.sh` against a temp INVENTORY.md seeded with
 * known anchors; injects synthetic probe outcomes via the
 * HOMELAB_VERIFY_* env-var lists. Six scenarios pin SC-8 semantics.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/homelab/verify.sh");
const FIXTURES = path.join(REPO_ROOT, "scripts/homelab/test-fixtures");

interface Workspace {
  dir: string;
}

// The names embedded in inventory-baseline.md's managed blocks (the
// discriminator field after the open marker — these are what verify.sh
// extracts and probes against).
const HOSTS = ["clawdy", "unraid", "oc-server", "jas-mbp"];
const VMS = ["webserver", "windows11-min", "moltbot-vm", "homeassistant", "oldvm"];
const CONTAINERS = ["novnc-auth", "novnc-win11"];

function setupWorkspace(): Workspace {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "homelab-verify-test-"));
  fs.copyFileSync(path.join(FIXTURES, "inventory-baseline.md"), path.join(dir, "INVENTORY.md"));
  fs.writeFileSync(path.join(dir, "NETWORK.md"), "# Network\n");
  return { dir };
}

function teardown(ws: Workspace) {
  fs.rmSync(ws.dir, { recursive: true, force: true });
}

interface RunOptions {
  env?: Record<string, string | undefined>;
  strict?: boolean;
  tunnels?: string[];
  allowNonZero?: boolean;
}

function runVerify(ws: Workspace, opts: RunOptions = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOMELAB_REPO: ws.dir,
    ...opts.env,
  };
  if (opts.tunnels && opts.tunnels.length > 0) {
    env.HOMELAB_VERIFY_TUNNELS = opts.tunnels.join(",");
  }
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete env[k];
  }
  const args = [SCRIPT, "--repo-path", ws.dir];
  if (opts.strict) args.push("--strict");
  const result = spawnSync("bash", args, { env, encoding: "utf8" });
  if (!opts.allowNonZero && result.status !== 0) {
    throw new Error(
      `verify.sh exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

let ws: Workspace;
beforeEach(() => {
  ws = setupWorkspace();
});
afterEach(() => {
  teardown(ws);
});

describe("Plan 03 / verify.sh", () => {
  it("Test 1: all-healthy fixture — exit 0 + every item status ok", () => {
    const res = runVerify(ws, {
      // The fixture includes OldVM which is NOT in any VIRSH_FAKE_RUNNING
      // list. To make Test 1 "all healthy", include it.
      env: {
        HOMELAB_VERIFY_PING_FAKE_OK: HOSTS.join(","),
        HOMELAB_VERIFY_VIRSH_FAKE_RUNNING: VMS.join(","),
        HOMELAB_VERIFY_DOCKER_FAKE_RUNNING: CONTAINERS.join(","),
        HOMELAB_VERIFY_CURL_FAKE_OK: "vm.jjagpal.me,dashboard.finmentum.com,notify.earlscheibconcord.com",
      },
      tunnels: ["vm.jjagpal.me", "dashboard.finmentum.com", "notify.earlscheibconcord.com"],
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("| clawdy | host |");
    expect(res.stdout).toContain("ok |");
    // Sanity: at least 4 + 5 + 2 + 3 = 14 status-ok rows
    const okMatches = res.stdout.match(/\| ok \|/g) ?? [];
    expect(okMatches.length).toBeGreaterThanOrEqual(14);
  });

  it("Test 2: one Tailscale IP unreachable — exit non-zero + report still complete", () => {
    const res = runVerify(ws, {
      env: {
        HOMELAB_VERIFY_PING_FAKE_OK: HOSTS.filter((h) => h !== "clawdy").join(","),
        HOMELAB_VERIFY_PING_FAKE_FAIL: "clawdy",
        HOMELAB_VERIFY_VIRSH_FAKE_RUNNING: VMS.join(","),
        HOMELAB_VERIFY_DOCKER_FAKE_RUNNING: CONTAINERS.join(","),
      },
      allowNonZero: true,
    });
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("| clawdy | host |");
    expect(res.stdout).toMatch(/\| clawdy \| host \|[^|]*\| unreachable \|/);
    // Other items reported.
    expect(res.stdout).toContain("| unraid | host |");
    expect(res.stdout).toContain("| webserver | vm |");
  });

  it("Test 3: one VM shut off — exit non-zero + verify continues past the failure", () => {
    const res = runVerify(ws, {
      env: {
        HOMELAB_VERIFY_PING_FAKE_OK: HOSTS.join(","),
        HOMELAB_VERIFY_VIRSH_FAKE_RUNNING: VMS.filter((v) => v !== "moltbot-vm").join(","),
        HOMELAB_VERIFY_VIRSH_FAKE_SHUT: "moltbot-vm",
        HOMELAB_VERIFY_DOCKER_FAKE_RUNNING: CONTAINERS.join(","),
      },
      allowNonZero: true,
    });
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/\| moltbot-vm \| vm \|[^|]*\| unreachable \|/);
    // Items AFTER moltbot-vm in the inventory must also appear — proves
    // verify.sh did NOT bail early on first failure.
    expect(res.stdout).toContain("| homeassistant | vm |");
    expect(res.stdout).toContain("| novnc-auth | container |");
  });

  it("Test 4: tunnel returns 403 — exit 0 (gated content is reachable)", () => {
    const res = runVerify(ws, {
      env: {
        HOMELAB_VERIFY_PING_FAKE_OK: HOSTS.join(","),
        HOMELAB_VERIFY_VIRSH_FAKE_RUNNING: VMS.join(","),
        HOMELAB_VERIFY_DOCKER_FAKE_RUNNING: CONTAINERS.join(","),
        HOMELAB_VERIFY_CURL_FAKE_403: "dashboard.finmentum.com",
      },
      tunnels: ["dashboard.finmentum.com"],
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/\| dashboard\.finmentum\.com \| tunnel \|[^|]*\| ok \|/);
  });

  it("Test 5: tunnel returns connection refused — exit non-zero", () => {
    const res = runVerify(ws, {
      env: {
        HOMELAB_VERIFY_PING_FAKE_OK: HOSTS.join(","),
        HOMELAB_VERIFY_VIRSH_FAKE_RUNNING: VMS.join(","),
        HOMELAB_VERIFY_DOCKER_FAKE_RUNNING: CONTAINERS.join(","),
        HOMELAB_VERIFY_CURL_FAKE_REFUSED: "vm.jjagpal.me",
      },
      tunnels: ["vm.jjagpal.me"],
      allowNonZero: true,
    });
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/\| vm\.jjagpal\.me \| tunnel \|[^|]*\| unreachable \|/);
  });

  it("Test 6: --strict treats unknown as unreachable; default treats unknown as warn", () => {
    // Container missing → status: unknown. Default = exit 0 (warn); --strict = exit non-zero.
    const baseEnv = {
      HOMELAB_VERIFY_PING_FAKE_OK: HOSTS.join(","),
      HOMELAB_VERIFY_VIRSH_FAKE_RUNNING: VMS.join(","),
      // Only mark novnc-auth as running; novnc-win11 → unknown (missing).
      HOMELAB_VERIFY_DOCKER_FAKE_RUNNING: "novnc-auth",
      HOMELAB_VERIFY_DOCKER_FAKE_MISSING: "novnc-win11",
    };
    const def = runVerify(ws, { env: baseEnv });
    expect(def.status).toBe(0);
    expect(def.stdout).toMatch(/\| novnc-win11 \| container \|[^|]*\| unknown \|/);
    expect(def.stdout).toContain("unknown=");

    const strict = runVerify(ws, { env: baseEnv, strict: true, allowNonZero: true });
    expect(strict.status).not.toBe(0);
    expect(strict.stdout).toMatch(/\| novnc-win11 \| container \|[^|]*\| unknown \|/);
  });
});
