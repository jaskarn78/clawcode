import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverChecks } from "../discovery.js";

describe("discoverChecks", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "heartbeat-checks-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("discovers valid check modules from a directory", async () => {
    writeFileSync(
      join(tempDir, "my-check.ts"),
      `export default { name: "my-check", execute: async () => ({ status: "healthy", message: "ok" }) };`,
    );

    const checks = await discoverChecks(tempDir);

    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe("my-check");
  });

  it("ignores .test.ts files", async () => {
    writeFileSync(
      join(tempDir, "valid.ts"),
      `export default { name: "valid", execute: async () => ({ status: "healthy", message: "ok" }) };`,
    );
    writeFileSync(
      join(tempDir, "valid.test.ts"),
      `export default { name: "test-file", execute: async () => ({ status: "healthy", message: "ok" }) };`,
    );

    const checks = await discoverChecks(tempDir);

    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe("valid");
  });

  it("ignores modules without valid default export", async () => {
    writeFileSync(
      join(tempDir, "bad-module.ts"),
      `export const notDefault = { name: "bad", execute: async () => ({}) };`,
    );

    const checks = await discoverChecks(tempDir);

    expect(checks).toHaveLength(0);
  });

  it("returns empty array for empty directory", async () => {
    const checks = await discoverChecks(tempDir);

    expect(checks).toHaveLength(0);
  });

  it("returns empty array for nonexistent directory", async () => {
    const checks = await discoverChecks(join(tempDir, "nonexistent"));

    expect(checks).toHaveLength(0);
  });

  it("ignores modules with no name property", async () => {
    writeFileSync(
      join(tempDir, "no-name.ts"),
      `export default { execute: async () => ({ status: "healthy", message: "ok" }) };`,
    );

    const checks = await discoverChecks(tempDir);

    expect(checks).toHaveLength(0);
  });

  it("ignores modules with no execute function", async () => {
    writeFileSync(
      join(tempDir, "no-execute.ts"),
      `export default { name: "no-execute" };`,
    );

    const checks = await discoverChecks(tempDir);

    expect(checks).toHaveLength(0);
  });
});
