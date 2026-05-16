import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readThreadRegistry,
  writeThreadRegistry,
  stampLastDeliveryAt,
  migrateBindingsForPhase999_36,
} from "../thread-registry.js";
import type {
  ThreadBinding,
  ThreadBindingRegistry,
} from "../thread-types.js";

const NOW = 1_700_000_000_000;

function binding(overrides: Partial<ThreadBinding> = {}): ThreadBinding {
  return {
    threadId: "thread-1",
    parentChannelId: "ch-1",
    agentName: "fin-acquisition-sub-AbC123",
    sessionName: "fin-acquisition-sub-AbC123",
    createdAt: NOW - 30 * 60_000,
    lastActivity: NOW - 10 * 60_000,
    ...overrides,
  };
}

let tmp: string;
let registryPath: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "thread-registry-test-"));
  registryPath = join(tmp, "thread-bindings.json");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("ThreadBinding back-compat: lastDeliveryAt", () => {
  it("parses a binding written WITHOUT lastDeliveryAt (pre-Phase-999.36)", async () => {
    const reg: ThreadBindingRegistry = {
      bindings: [binding()],
      updatedAt: NOW,
    };
    await writeThreadRegistry(registryPath, reg);
    const out = await readThreadRegistry(registryPath);
    expect(out.bindings[0]!.threadId).toBe("thread-1");
    expect(out.bindings[0]!.lastDeliveryAt).toBeUndefined();
  });

  it("round-trips a binding with lastDeliveryAt = 1234567890", async () => {
    const reg: ThreadBindingRegistry = {
      bindings: [binding({ lastDeliveryAt: 1234567890 })],
      updatedAt: NOW,
    };
    await writeThreadRegistry(registryPath, reg);
    const out = await readThreadRegistry(registryPath);
    expect(out.bindings[0]!.lastDeliveryAt).toBe(1234567890);
  });

  it("preserves lastDeliveryAt: null as null (NOT coerced to undefined)", async () => {
    const reg: ThreadBindingRegistry = {
      bindings: [binding({ lastDeliveryAt: null })],
      updatedAt: NOW,
    };
    await writeThreadRegistry(registryPath, reg);
    const raw = await readFile(registryPath, "utf-8");
    expect(raw).toContain('"lastDeliveryAt": null');
    const out = await readThreadRegistry(registryPath);
    expect(out.bindings[0]!.lastDeliveryAt).toBeNull();
  });
});

describe("stampLastDeliveryAt", () => {
  it("returns no-binding when threadId is unknown", async () => {
    const reg: ThreadBindingRegistry = { bindings: [], updatedAt: 0 };
    await writeThreadRegistry(registryPath, reg);
    const r = await stampLastDeliveryAt(registryPath, "missing", NOW);
    expect(r).toEqual({ ok: false, reason: "no-binding" });
  });

  it("stamps lastDeliveryAt on an existing binding", async () => {
    const reg: ThreadBindingRegistry = {
      bindings: [binding()],
      updatedAt: 0,
    };
    await writeThreadRegistry(registryPath, reg);
    const r = await stampLastDeliveryAt(registryPath, "thread-1", NOW);
    expect(r).toEqual({ ok: true });
    const out = await readThreadRegistry(registryPath);
    expect(out.bindings[0]!.lastDeliveryAt).toBe(NOW);
    expect(out.bindings[0]!.threadId).toBe("thread-1");
    expect(out.bindings[0]!.lastActivity).toBe(binding().lastActivity);
  });

  it("does not mutate sibling bindings", async () => {
    const reg: ThreadBindingRegistry = {
      bindings: [
        binding({ threadId: "thread-1" }),
        binding({ threadId: "thread-2" }),
      ],
      updatedAt: 0,
    };
    await writeThreadRegistry(registryPath, reg);
    await stampLastDeliveryAt(registryPath, "thread-2", NOW);
    const out = await readThreadRegistry(registryPath);
    expect(out.bindings[0]!.lastDeliveryAt).toBeUndefined();
    expect(out.bindings[1]!.lastDeliveryAt).toBe(NOW);
  });

  it("idempotent — re-stamping same threadId is a clean overwrite", async () => {
    const reg: ThreadBindingRegistry = {
      bindings: [binding()],
      updatedAt: 0,
    };
    await writeThreadRegistry(registryPath, reg);
    const r1 = await stampLastDeliveryAt(registryPath, "thread-1", 1111);
    const r2 = await stampLastDeliveryAt(registryPath, "thread-1", 2222);
    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    const out = await readThreadRegistry(registryPath);
    expect(out.bindings[0]!.lastDeliveryAt).toBe(2222);
  });
});

describe("migrateBindingsForPhase999_36", () => {
  it("returns migrated=0 when no bindings exist", async () => {
    await writeThreadRegistry(registryPath, { bindings: [], updatedAt: 0 });
    const r = await migrateBindingsForPhase999_36(registryPath);
    expect(r).toEqual({ migrated: 0, total: 0 });
  });

  it("backfills lastDeliveryAt = lastActivity for pre-Phase entries", async () => {
    const reg: ThreadBindingRegistry = {
      bindings: [binding({ lastActivity: 1111 })],
      updatedAt: 0,
    };
    await writeThreadRegistry(registryPath, reg);
    const r = await migrateBindingsForPhase999_36(registryPath);
    expect(r.migrated).toBe(1);
    const out = await readThreadRegistry(registryPath);
    expect(out.bindings[0]!.lastDeliveryAt).toBe(1111);
  });

  it("is idempotent — re-running on already-migrated bindings is a no-op", async () => {
    const reg: ThreadBindingRegistry = {
      bindings: [binding({ lastDeliveryAt: 9999 })],
      updatedAt: 0,
    };
    await writeThreadRegistry(registryPath, reg);
    const r = await migrateBindingsForPhase999_36(registryPath);
    expect(r.migrated).toBe(0);
    const out = await readThreadRegistry(registryPath);
    expect(out.bindings[0]!.lastDeliveryAt).toBe(9999);
  });

  it("skips terminal bindings (completedAt set) without backfill", async () => {
    const reg: ThreadBindingRegistry = {
      bindings: [
        binding({
          threadId: "t-terminal",
          completedAt: NOW - 5_000,
          lastActivity: 2222,
        }),
      ],
      updatedAt: 0,
    };
    await writeThreadRegistry(registryPath, reg);
    const r = await migrateBindingsForPhase999_36(registryPath);
    expect(r.migrated).toBe(0);
    const out = await readThreadRegistry(registryPath);
    expect(out.bindings[0]!.lastDeliveryAt).toBeUndefined();
  });
});
