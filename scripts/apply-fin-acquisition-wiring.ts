#!/usr/bin/env tsx
/**
 * Phase 90 Plan 07 WIRE-01..04 — one-shot wiring script for the
 * fin-acquisition ClawCode agent.
 *
 * Applies the patch described in 90-07-PLAN.md:
 *   - mcpServers: [finmentum-db, finmentum-content, google-workspace,
 *                  browserless, fal-ai, brave-search]
 *   - heartbeat:  { every: "50m", model: haiku, prompt: <verbatim from
 *                  ~/.openclaw/workspace-finmentum/HEARTBEAT.md> }
 *   - effort:     "auto"
 *   - allowedModels: [sonnet, opus, haiku]
 *   - greetOnRestart: true
 *   - greetCoolDownMs: 300000
 *
 * Channel binding is INTENTIONALLY unchanged — the OpenClaw→ClawCode
 * cutover of `1481670479017414767` is operator-triggered per user
 * directive (see .planning/migrations/fin-acquisition-cutover.md).
 *
 * Idempotent: re-running against an already-patched clawcode.yaml
 * yields outcome "no-op" and leaves bytes unchanged.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { updateAgentConfig } from "../src/migration/yaml-writer.js";

async function main(): Promise<void> {
  const configPath = resolve("clawcode.yaml");
  const heartbeatPath = resolve(
    homedir(),
    ".openclaw/workspace-finmentum/HEARTBEAT.md",
  );

  let heartbeatPrompt: string;
  try {
    heartbeatPrompt = await readFile(heartbeatPath, "utf-8");
    console.log(
      `loaded heartbeat prompt (${heartbeatPrompt.length} bytes) from ${heartbeatPath}`,
    );
  } catch {
    heartbeatPrompt =
      "<HEARTBEAT.md content — operator must paste from ~/.openclaw/workspace-finmentum/HEARTBEAT.md>";
    console.warn(
      `WARN: ${heartbeatPath} not readable; using placeholder. Edit clawcode.yaml manually after HEARTBEAT.md is available.`,
    );
  }

  const result = await updateAgentConfig({
    existingConfigPath: configPath,
    agentName: "fin-acquisition",
    patch: {
      effort: "auto",
      allowedModels: ["sonnet", "opus", "haiku"],
      greetOnRestart: true,
      greetCoolDownMs: 300_000,
      heartbeat: {
        every: "50m",
        model: "haiku",
        prompt: heartbeatPrompt,
      },
      mcpServers: [
        "finmentum-db",
        "finmentum-content",
        "google-workspace",
        "browserless",
        "fal-ai",
        "brave-search",
      ],
    },
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.outcome !== "updated" && result.outcome !== "no-op") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
