import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCgroupMemoryStats } from "../cgroup-stats.js";

describe("readCgroupMemoryStats", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cgroup-stats-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns memoryCurrent + memoryMax + memoryPercent from cgroup files", async () => {
    await writeFile(`${dir}/memory.current`, "21013143552\n");
    await writeFile(`${dir}/memory.max`, "21474836480\n");
    const stats = await readCgroupMemoryStats(dir);
    expect(stats).not.toBeNull();
    expect(stats!.memoryCurrent).toBe(21_013_143_552);
    expect(stats!.memoryMax).toBe(21_474_836_480);
    expect(stats!.memoryPercent).toBeCloseTo(97.85, 1);
    expect(stats!.path).toBe(dir);
  });

  it("returns memoryMax=null and memoryPercent=null when memory.max is 'max'", async () => {
    await writeFile(`${dir}/memory.current`, "12345\n");
    await writeFile(`${dir}/memory.max`, "max\n");
    const stats = await readCgroupMemoryStats(dir);
    expect(stats).not.toBeNull();
    expect(stats!.memoryCurrent).toBe(12345);
    expect(stats!.memoryMax).toBeNull();
    expect(stats!.memoryPercent).toBeNull();
  });

  it("returns null when cgroup directory is missing", async () => {
    const stats = await readCgroupMemoryStats(join(dir, "does-not-exist"));
    expect(stats).toBeNull();
  });

  it("returns null when memory.current is non-numeric", async () => {
    await writeFile(`${dir}/memory.current`, "not-a-number\n");
    await writeFile(`${dir}/memory.max`, "100\n");
    const stats = await readCgroupMemoryStats(dir);
    expect(stats).toBeNull();
  });

  it("handles memoryMax=0 by returning memoryPercent=null (avoid divide-by-zero)", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/memory.current`, "0\n");
    await writeFile(`${dir}/memory.max`, "0\n");
    const stats = await readCgroupMemoryStats(dir);
    expect(stats).not.toBeNull();
    expect(stats!.memoryPercent).toBeNull();
  });
});
