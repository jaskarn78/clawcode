import { describe, it, expect } from "vitest";
import { buildCapabilityManifest } from "../capability-manifest.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";

/**
 * Phase 100 follow-up — capability manifest builder.
 *
 * The manifest is auto-injected into the system prompt so the LLM has
 * enabled features in context (avoiding the "I don't dream" failure mode
 * observed in fin-acquisition on 2026-04-27). Pure function — reads only
 * from ResolvedAgentConfig (no I/O, no hallucination).
 */
function makeConfig(
  overrides: Partial<ResolvedAgentConfig> = {},
): ResolvedAgentConfig {
  return {
    name: "test-agent",
    workspace: "/tmp/test-workspace",
    memoryPath: "/tmp/test-workspace",
    channels: [],
    model: "sonnet",
    effort: "low",
    allowedModels: ["haiku", "sonnet", "opus"],
    greetOnRestart: true,
    greetCoolDownMs: 300_000,
    memoryAutoLoad: true,
    memoryRetrievalTopK: 5,
    memoryScannerEnabled: true,
    memoryFlushIntervalMs: 900_000,
    memoryCueEmoji: "✅",
    settingSources: ["project"],
    skills: [],
    soul: undefined,
    identity: undefined,
    memory: {
      compactionThreshold: 0.75,
      searchTopK: 10,
      consolidation: {
        enabled: true,
        weeklyThreshold: 7,
        monthlyThreshold: 4,
        schedule: "0 3 * * *",
      },
      decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 },
      deduplication: { enabled: true, similarityThreshold: 0.85 },
    },
    schedules: [],
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75 },
    },
    skillsPath: "/tmp/skills",
    admin: false,
    subagentModel: undefined,
    threads: { idleTimeoutMinutes: 30, maxThreadSessions: 5 },
    reactions: false,
    slashCommands: [],
    mcpServers: [],
    ...overrides,
  };
}

describe("buildCapabilityManifest", () => {
  it("CM-1: agent with all features enabled emits Memory dreaming + Scheduled tasks + Subagent threads + GSD bullets", () => {
    const cfg = makeConfig({
      dream: { enabled: true, idleMinutes: 30, model: "haiku" },
      schedules: [
        {
          name: "morning-standup",
          cron: "0 9 * * *",
          prompt: "say good morning",
          enabled: true,
        },
        {
          name: "weekly-review",
          cron: "0 17 * * 5",
          prompt: "review the week",
          enabled: true,
        },
      ],
      skills: ["subagent-thread"],
      gsd: { projectDir: "/opt/clawcode-projects/sandbox" },
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("Your ClawCode Capabilities");
    expect(manifest).toContain("Memory dreaming");
    expect(manifest).toContain("auto-fires every 30min idle");
    expect(manifest).toContain("model=haiku");
    expect(manifest).toContain("/clawcode-dream");
    expect(manifest).toContain("Scheduled tasks");
    expect(manifest).toContain("2"); // schedule count
    expect(manifest).toContain("Subagent threads");
    expect(manifest).toContain("spawn_subagent_thread");
    expect(manifest).toContain("GSD workflow");
    expect(manifest).toContain("/opt/clawcode-projects/sandbox");
  });

  it("CM-2: agent without dream config omits the dreaming bullet", () => {
    const cfg = makeConfig({
      dream: undefined,
      schedules: [
        {
          name: "tick",
          cron: "*/5 * * * *",
          prompt: "tick",
          enabled: true,
        },
      ],
    });

    const manifest = buildCapabilityManifest(cfg);
    // Manifest is non-empty (schedules present) but dreaming bullet omitted.
    expect(manifest).not.toContain("Memory dreaming");
    expect(manifest).toContain("Scheduled tasks");
  });

  it("CM-2b: agent with dream.enabled=false omits the dreaming bullet (operator opted out)", () => {
    const cfg = makeConfig({
      dream: { enabled: false, idleMinutes: 30, model: "haiku" },
      skills: ["subagent-thread"],
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).not.toContain("Memory dreaming");
    // Subagent thread bullet still appears.
    expect(manifest).toContain("Subagent threads");
  });

  it("CM-3: agent with no schedules omits the scheduled-tasks bullet", () => {
    const cfg = makeConfig({
      dream: { enabled: true, idleMinutes: 30, model: "haiku" },
      schedules: [],
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("Memory dreaming");
    expect(manifest).not.toContain("Scheduled tasks");
  });

  it("CM-4: minimal agent (no features) returns empty string", () => {
    const cfg = makeConfig({
      dream: undefined,
      schedules: [],
      skills: [],
      gsd: undefined,
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toBe("");
  });

  it("CM-4b: agent with only memoryAutoLoad enabled (no dream/schedules/skills/gsd) still returns empty", () => {
    // Memory auto-load is the fleet-wide default — it's not "notable" enough
    // to bloat minimal agents' prompts. The manifest is for OPTED-IN features.
    const cfg = makeConfig({
      dream: undefined,
      schedules: [],
      skills: [],
      gsd: undefined,
      memoryAutoLoad: true,
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toBe("");
  });

  it("CM-5: dream bullet uses the agent's actual idleMinutes + model (no hallucination)", () => {
    const cfg = makeConfig({
      dream: { enabled: true, idleMinutes: 90, model: "sonnet" },
      schedules: [],
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("auto-fires every 90min idle");
    expect(manifest).toContain("model=sonnet");
  });

  it("CM-6: subagent thread bullet only appears when the skill is assigned", () => {
    const withoutSkill = buildCapabilityManifest(
      makeConfig({
        dream: { enabled: true, idleMinutes: 30, model: "haiku" },
        skills: [],
      }),
    );
    expect(withoutSkill).not.toContain("Subagent threads");

    const withSkill = buildCapabilityManifest(
      makeConfig({
        dream: { enabled: true, idleMinutes: 30, model: "haiku" },
        skills: ["subagent-thread"],
      }),
    );
    expect(withSkill).toContain("Subagent threads");
  });

  it("CM-7: GSD bullet only appears when gsd.projectDir is set", () => {
    const cfg = makeConfig({
      schedules: [
        {
          name: "tick",
          cron: "*/5 * * * *",
          prompt: "tick",
          enabled: true,
        },
      ],
      gsd: undefined,
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).not.toContain("GSD workflow");
  });

  // ---------------------------------------------------------------------------
  // Phase 100-fu — Tier 1 + Tier 2 manifest extension (2026-04-26)
  // ---------------------------------------------------------------------------

  it("CM-MCP-1: agent with mcpServers (description + accessPattern) → MCP servers bullet with annotations", () => {
    const cfg = makeConfig({
      mcpServers: [
        {
          name: "1password",
          command: "npx",
          args: [],
          env: {},
          optional: false,
          description: "secrets retrieval",
          accessPattern: "read-only",
        },
        {
          name: "finmentum-db",
          command: "mcporter",
          args: [],
          env: {},
          optional: false,
          description: "Postgres SELECT",
          accessPattern: "read-only",
        },
        {
          name: "playwright",
          command: "npx",
          args: [],
          env: {},
          optional: false,
          description: "browser automation",
          // accessPattern omitted on purpose — bullet should still render
        },
      ],
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("MCP servers");
    expect(manifest).toContain("1password (secrets retrieval — read-only)");
    expect(manifest).toContain("finmentum-db (Postgres SELECT — read-only)");
    expect(manifest).toContain("playwright (browser automation)");
  });

  it("CM-MCP-2: mcpServer entries without description fall back to just the name", () => {
    const cfg = makeConfig({
      mcpServers: [
        {
          name: "clawcode",
          command: "clawcode",
          args: ["mcp"],
          env: {},
          optional: false,
          // no description, no accessPattern
        },
      ],
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("MCP servers");
    expect(manifest).toContain("clawcode");
    // No qualifier in parens — bare name only.
    expect(manifest).not.toContain("clawcode (");
  });

  it("CM-SKILLS-1: agent with skills → manifest includes a Skills bullet", () => {
    const cfg = makeConfig({
      skills: ["subagent-thread", "memory-recall", "research", "synthesis"],
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("Skills");
    expect(manifest).toContain("subagent-thread");
    expect(manifest).toContain("memory-recall");
    expect(manifest).toContain("research");
    expect(manifest).toContain("synthesis");
  });

  it("CM-SKILLS-EMPTY: agent with empty skills → no Skills bullet", () => {
    const cfg = makeConfig({
      skills: [],
      // need something else opted-in so the manifest is non-empty
      gsd: { projectDir: "/tmp/p" },
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).not.toMatch(/^- \*\*Skills\*\*:/m);
  });

  it("CM-MODEL-1: model + effort included", () => {
    const cfg = makeConfig({
      model: "opus",
      effort: "high",
      // ensure the manifest renders something so we can scan it
      gsd: { projectDir: "/tmp/p" },
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("model=opus");
    expect(manifest).toContain("effort=high");
  });

  it("CM-CONV-1: 'Prior session summaries auto-resume' line present", () => {
    const cfg = makeConfig({
      gsd: { projectDir: "/tmp/p" },
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("Prior session summaries auto-resume");
    expect(manifest).toContain("Working memory of recent turns");
  });

  it("CM-FILE-1: fileAccess paths rendered when present", () => {
    const cfg = makeConfig({
      fileAccess: [
        "/home/clawcode/.clawcode/agents/test-agent/",
        "/srv/shared/finmentum/",
      ],
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("File access");
    expect(manifest).toContain("/home/clawcode/.clawcode/agents/test-agent/");
    expect(manifest).toContain("/srv/shared/finmentum/");
  });

  it("CM-FILE-EMPTY: no fileAccess bullet when undefined or empty", () => {
    const cfg = makeConfig({
      fileAccess: undefined,
      gsd: { projectDir: "/tmp/p" },
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).not.toMatch(/^- \*\*File access\*\*:/m);
  });

  it("CM-HEART-1: heartbeat enabled → renders 'every model' summary", () => {
    const cfg = makeConfig({
      heartbeat: {
        enabled: true,
        intervalSeconds: 60,
        checkTimeoutSeconds: 10,
        contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75 },
        every: "50m",
        model: "haiku",
      } as ResolvedAgentConfig["heartbeat"],
      // Trigger non-empty manifest so the heartbeat bullet renders.
      gsd: { projectDir: "/tmp/p" },
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("Heartbeat");
    expect(manifest).toContain("50m");
    expect(manifest).toContain("haiku");
  });

  it("CM-HEART-DISABLED: heartbeat disabled → renders 'disabled'", () => {
    const cfg = makeConfig({
      heartbeat: {
        enabled: false,
        intervalSeconds: 60,
        checkTimeoutSeconds: 10,
        contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75 },
      },
      gsd: { projectDir: "/tmp/p" },
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("Heartbeat");
    expect(manifest).toContain("disabled");
  });

  it("CM-RECUR-1: recursion guard sentence present", () => {
    const cfg = makeConfig({
      skills: ["subagent-thread"],
    });

    const manifest = buildCapabilityManifest(cfg);
    // The recursion-guard bullet ALWAYS renders (informational about how the
    // SDK enforces "subagents cannot spawn subagents").
    expect(manifest).toContain("recursion is impossible by design");
    expect(manifest).toContain("-sub-");
  });

  it("CM-AUTOREALAY-1: subagent-thread bullet mentions autoRelay default", () => {
    const cfg = makeConfig({
      skills: ["subagent-thread"],
    });

    const manifest = buildCapabilityManifest(cfg);
    expect(manifest).toContain("Subagent threads");
    expect(manifest).toContain("autoRelay");
    expect(manifest).toContain("autoArchive");
  });

  it("CM-EMPTY-FIELDS: empty Tier 2 fields are omitted (no bloat)", () => {
    // Minimal-ish agent — only one feature opted in. Tier 2 fields should
    // not produce empty bullets.
    const cfg = makeConfig({
      skills: [],
      mcpServers: [],
      fileAccess: undefined,
      gsd: { projectDir: "/tmp/p" },
    });

    const manifest = buildCapabilityManifest(cfg);
    // Skills/MCP/FileAccess bullets are absent
    expect(manifest).not.toMatch(/^- \*\*Skills\*\*:/m);
    expect(manifest).not.toMatch(/^- \*\*MCP servers\*\*:/m);
    expect(manifest).not.toMatch(/^- \*\*File access\*\*:/m);
  });
});
