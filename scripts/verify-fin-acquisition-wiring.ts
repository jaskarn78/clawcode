#!/usr/bin/env tsx
/**
 * Phase 90 Plan 07 — ad-hoc verification that the fin-acquisition wiring
 * round-trips through the config loader. Not a vitest test (that's covered
 * by yaml-writer.test.ts WIRE-A1..A3) — this one validates the ACTUAL
 * clawcode.yaml on disk parses + resolves correctly.
 */
import { loadConfig, resolveAllAgents } from "../src/config/loader.js";

async function main(): Promise<void> {
  const c = await loadConfig("clawcode.yaml");
  const agents = resolveAllAgents(c);
  console.log("Config parse OK. agents:", agents.length);

  const fin = agents.find((a) => a.name === "fin-acquisition");
  if (!fin) {
    console.error("ERROR: fin-acquisition not found in resolved agents");
    process.exit(1);
  }
  console.log("fin-acquisition.channels:", JSON.stringify(fin.channels));
  console.log("fin-acquisition.effort:", fin.effort);
  console.log(
    "fin-acquisition.allowedModels:",
    JSON.stringify(fin.allowedModels),
  );
  console.log("fin-acquisition.greetOnRestart:", fin.greetOnRestart);
  console.log("fin-acquisition.greetCoolDownMs:", fin.greetCoolDownMs);
  console.log(
    "fin-acquisition.mcpServers (resolved):",
    fin.mcpServers.map((m) => m.name),
  );

  // Channel binding MUST be 1481670479017414767 (unchanged by Plan 07).
  if (
    fin.channels.length !== 1 ||
    fin.channels[0] !== "1481670479017414767"
  ) {
    console.error(
      "ERROR: fin-acquisition channel binding changed — expected [1481670479017414767]",
    );
    process.exit(1);
  }

  console.log("OK — fin-acquisition wiring verified end-to-end");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
