/**
 * Phase 110-03 Task 2 — Tests for npm postinstall hook.
 *
 * Behavior under test:
 *  1. linux/x64 selects prebuilds/linux-amd64/clawcode-mcp-shim
 *  2. linux/arm64 selects prebuilds/linux-arm64/clawcode-mcp-shim
 *  3. unsupported platform (darwin) throws (fail-loud)
 *  4. install() actually places binary at target with execute permission
 *  5. install() is idempotent (running twice doesn't error)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { selectPrebuild, install } from "../postinstall-shim.cjs";

describe("selectPrebuild", () => {
  it("Test 1: linux x64 selects amd64 prebuild path", () => {
    const result = selectPrebuild("linux", "x64");
    // Use `sep` so this passes on any host that runs the test, but the
    // production target is linux so forward slashes are the canonical form.
    expect(result.split(sep).join("/")).toBe("prebuilds/linux-amd64/clawcode-mcp-shim");
  });

  it("Test 2: linux arm64 selects arm64 prebuild path", () => {
    const result = selectPrebuild("linux", "arm64");
    expect(result.split(sep).join("/")).toBe("prebuilds/linux-arm64/clawcode-mcp-shim");
  });

  it("Test 3: unsupported platform fails loud (no silent skip)", () => {
    expect(() => selectPrebuild("darwin", "arm64")).toThrowError(
      /no prebuilt binary for darwin-arm64/i,
    );
    expect(() => selectPrebuild("win32", "x64")).toThrowError(
      /no prebuilt binary for win32-x64/i,
    );
  });
});

describe("install", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "postinstall-shim-"));
    // Lay down a fake prebuild matching what the npm tarball ships.
    const prebuildDir = join(tmp, "prebuilds", "linux-amd64");
    mkdirSync(prebuildDir, { recursive: true });
    writeFileSync(join(prebuildDir, "clawcode-mcp-shim"), "#!/bin/sh\necho fake\n", {
      mode: 0o644,
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("Test 4: copy actually places binary at node_modules/.bin with exec perm", () => {
    // Force x64 selection regardless of host (test must work on arm64 dev machines too).
    const target = join(tmp, "node_modules", ".bin", "clawcode-mcp-shim");
    install({ pkgRoot: tmp, target, platform: "linux", arch: "x64" });

    expect(existsSync(target)).toBe(true);
    const st = statSync(target);
    // Mode includes execute bit for owner, group, other.
    expect((st.mode & 0o111) !== 0).toBe(true);
    // Content was copied from the prebuild.
    expect(readFileSync(target, "utf8")).toContain("fake");
  });

  it("Test 5: idempotent — running install twice does not error", () => {
    const target = join(tmp, "node_modules", ".bin", "clawcode-mcp-shim");
    install({ pkgRoot: tmp, target, platform: "linux", arch: "x64" });
    expect(() =>
      install({ pkgRoot: tmp, target, platform: "linux", arch: "x64" }),
    ).not.toThrow();
    expect(existsSync(target)).toBe(true);
  });

  it("install throws if prebuild file is missing in pkgRoot", () => {
    // Different arch's prebuild not laid down — should fail loud.
    const target = join(tmp, "node_modules", ".bin", "clawcode-mcp-shim");
    expect(() =>
      install({ pkgRoot: tmp, target, platform: "linux", arch: "arm64" }),
    ).toThrowError(/prebuild missing/i);
  });
});
