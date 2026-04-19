import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { EmbeddingService } from "../../memory/embedder.js";
import { ManagerError } from "../../shared/errors.js";

/** Recursive walk — skips __tests__ dirs and *.test.ts files. */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTs(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Phase 56 Plan 01 — daemon startup embedder probe + singleton invariant.
 *
 * These tests cover the probe contract without spinning up the full
 * `startDaemon` integration surface (which requires Discord, SQLite files,
 * sockets, etc.). Instead we:
 *   (a) unit-test a probe runner that mirrors the daemon's call pattern,
 *   (b) grep the actual `daemon.ts` source to assert the probe is wired
 *       in the documented position with the documented ManagerError path,
 *   (c) enforce the singleton invariant by grepping `src/`.
 */

/**
 * Mirror of the daemon's probe step. Kept as a standalone helper so the
 * hard-fail contract is testable without booting the full daemon.
 */
async function probeEmbedderOrFail(
  embedder: Pick<EmbeddingService, "embed">,
): Promise<void> {
  try {
    await embedder.embed("warmup probe");
  } catch (err) {
    throw new ManagerError(
      `embedder probe failed: ${(err as Error).message} — daemon cannot start without a working embedding pipeline`,
    );
  }
}

describe("daemon embedder probe", () => {
  it("calls embed('warmup probe') exactly once on success", async () => {
    let calls = 0;
    let lastText: string | null = null;
    const embedder = {
      embed: async (text: string) => {
        calls += 1;
        lastText = text;
        return new Float32Array(384);
      },
    };
    await probeEmbedderOrFail(embedder);
    expect(calls).toBe(1);
    expect(lastText).toBe("warmup probe");
  });

  it("throws ManagerError with 'embedder probe failed' when embed rejects", async () => {
    const embedder = {
      embed: async () => {
        throw new Error("onnx offline");
      },
    };
    await expect(probeEmbedderOrFail(embedder)).rejects.toThrow(
      /embedder probe failed: onnx offline/,
    );
    await expect(probeEmbedderOrFail(embedder)).rejects.toBeInstanceOf(
      ManagerError,
    );
  });
});

describe("daemon.ts probe wiring (source-level grep)", () => {
  const src = readFileSync(
    new URL("../daemon.ts", import.meta.url),
    "utf-8",
  );

  it("calls embed(\"warmup probe\") exactly once", () => {
    const matches = src.match(/embed\(\s*"warmup probe"\s*\)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("wraps the probe in a ManagerError hard-fail path", () => {
    // The probe error branch should throw ManagerError with a recognizable
    // message. Search the whole file for both tokens — they must co-exist.
    expect(src).toMatch(/embedder probe failed/);
    expect(src).toMatch(/new ManagerError\(/);
  });

  it("places the probe AFTER warmupEmbeddings() but BEFORE the IPC server creation", () => {
    const warmupIdx = src.indexOf("manager.warmupEmbeddings()");
    const probeIdx = src.indexOf('embed("warmup probe")');
    const ipcServerIdx = src.indexOf("createIpcServer(");
    expect(warmupIdx).toBeGreaterThan(-1);
    expect(probeIdx).toBeGreaterThan(warmupIdx);
    expect(ipcServerIdx).toBeGreaterThan(probeIdx);
  });
});

// ---------------------------------------------------------------------------
// Phase 70 Plan 03 — browser warm probe wiring.
//
// Mirrors the embedder probe grep-contract above: we grep the daemon.ts
// source to assert the browser warm call, hard-fail path, and shutdown
// close ordering are wired correctly. Keeps tests hermetic — no real
// Chromium boot during unit test runs.
// ---------------------------------------------------------------------------
describe("daemon.ts browser warm wiring (Phase 70 Plan 03 — source grep)", () => {
  const src = readFileSync(
    new URL("../daemon.ts", import.meta.url),
    "utf-8",
  );

  it("instantiates the BrowserManager singleton exactly once", () => {
    const matches = src.match(/new BrowserManager\(/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("calls browserManager.warm() under a warmOnBoot guard", () => {
    expect(src).toMatch(/browserManager\.warm\(\)/);
    // The warm call should be gated by both enabled and warmOnBoot.
    expect(src).toMatch(/browserCfg\.enabled && browserCfg\.warmOnBoot/);
  });

  it("wraps the browser warm call in a ManagerError hard-fail path", () => {
    expect(src).toMatch(/browser warm probe failed/);
    // The same ManagerError import is used as the embedder probe.
    const matches = src.match(/new ManagerError\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // embedder + browser
  });

  it("logs a skip message when defaults.browser.enabled is false", () => {
    expect(src).toMatch(/browser MCP disabled/);
  });

  it("logs a lazy-warm message when warmOnBoot is false", () => {
    expect(src).toMatch(/Chromium will launch lazily/);
  });

  it("dispatches browser-tool-call BEFORE routeMethod", () => {
    const browserCall = src.indexOf('"browser-tool-call"');
    const routeMethodCall = src.indexOf(
      "return routeMethod(manager, resolvedAgents",
    );
    expect(browserCall).toBeGreaterThan(-1);
    expect(routeMethodCall).toBeGreaterThan(-1);
    expect(browserCall).toBeLessThan(routeMethodCall);
  });

  it("calls browserManager.close() BEFORE server.close() on shutdown", () => {
    const closeCall = src.indexOf("browserManager.close()");
    const serverClose = src.indexOf("server.close();");
    expect(closeCall).toBeGreaterThan(-1);
    expect(serverClose).toBeGreaterThan(-1);
    expect(closeCall).toBeLessThan(serverClose);
  });

  it("places the browser warm AFTER the embedder probe", () => {
    const embedderProbe = src.indexOf('embed("warmup probe")');
    const browserWarm = src.indexOf("browserManager.warm()");
    expect(embedderProbe).toBeGreaterThan(-1);
    expect(browserWarm).toBeGreaterThan(-1);
    expect(browserWarm).toBeGreaterThan(embedderProbe);
  });
});

// ---------------------------------------------------------------------------
// Phase 71 Plan 02 — search MCP daemon wiring (source grep).
//
// Mirrors the browser grep-contract above: assert the daemon constructs
// the BraveClient + ExaClient, registers the search-tool-call IPC handler
// BEFORE routeMethod, and never calls a `warm()` on the search clients
// (HTTP clients are lazy per-CONTEXT).
// ---------------------------------------------------------------------------
describe("daemon.ts search wiring (Phase 71 Plan 02 — source grep)", () => {
  const src = readFileSync(
    new URL("../daemon.ts", import.meta.url),
    "utf-8",
  );

  it("G1: IPC method 'search-tool-call' is registered", () => {
    expect(src).toMatch(/["']search-tool-call["']/);
  });

  it("G2: imports handleSearchToolCall from the search module", () => {
    expect(src).toMatch(
      /import\s+\{[^}]*handleSearchToolCall[^}]*\}\s+from\s+["']\.\.\/search\/daemon-handler\.js["']/,
    );
  });

  it("G3: constructs BraveClient + ExaClient at daemon boot, after browser block", () => {
    const braveCtor = src.indexOf("createBraveClient(");
    const exaCtor = src.indexOf("createExaClient(");
    const browserWarm = src.indexOf("browserManager.warm()");
    expect(braveCtor).toBeGreaterThan(-1);
    expect(exaCtor).toBeGreaterThan(-1);
    expect(browserWarm).toBeGreaterThan(-1);
    // Construction lives after the browser warm block.
    expect(braveCtor).toBeGreaterThan(browserWarm);
    expect(exaCtor).toBeGreaterThan(browserWarm);
  });

  it("G4: dispatches search-tool-call BEFORE routeMethod", () => {
    const searchCall = src.indexOf('"search-tool-call"');
    const routeMethodCall = src.indexOf(
      "return routeMethod(manager, resolvedAgents",
    );
    expect(searchCall).toBeGreaterThan(-1);
    expect(routeMethodCall).toBeGreaterThan(-1);
    expect(searchCall).toBeLessThan(routeMethodCall);
  });

  it("G5: does NOT call a warm()/isReady() method on search clients at boot", () => {
    // HTTP clients are lazy — no warm-path probe. The only warm/isReady
    // references in daemon.ts should be browserManager's.
    expect(src).not.toMatch(/braveClient\.warm|exaClient\.warm/);
    expect(src).not.toMatch(/braveClient\.isReady|exaClient\.isReady/);
  });
});

describe("EmbeddingService singleton invariant (src-level grep)", () => {
  it("src/ has exactly one production construction of EmbeddingService", () => {
    // Resolve src/ from this test file (works regardless of cwd in vitest).
    const srcDir = new URL("../../", import.meta.url).pathname;
    const files = walkTs(srcDir);

    const hits: { file: string; matches: number }[] = [];
    for (const f of files) {
      const content = readFileSync(f, "utf-8");
      const m = content.match(/new EmbeddingService\s*\(/g);
      if (m && m.length > 0) {
        hits.push({ file: relative(srcDir, f), matches: m.length });
      }
    }

    // Exactly one production construction, and it must live in
    // manager/session-memory.ts (the AgentMemoryManager singleton).
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe("manager/session-memory.ts");
    expect(hits[0].matches).toBe(1);
  });
});
