/**
 * Phase 103 OBS-07 — usage-embed module unit tests.
 *
 * Pins the pure /clawcode-usage panel renderer:
 *   - 5 renderBar tests (50% / 0% / 100% / undefined / clamping)
 *   - 9 buildUsageEmbed tests (empty graceful, color triage, field order,
 *     overage status-line, surpassedThreshold field, unknown type tolerance,
 *     footer)
 *
 * Pitfall closures pinned:
 *   - Pitfall 7: empty snapshots → "No usage data yet" (NOT empty embed)
 *   - Pitfall 9: surpassedThreshold is OPTIONAL NUMBER, rendered as separate
 *     field when defined
 *   - Pitfall 10: rateLimitType "unknown" tolerated without throw
 *   - Open Q3: overage rendered as status-line, NOT a progress bar
 *
 * Test file is pure (no Discord client) — buildUsageEmbed accepts plain
 * snapshot literals + returns an EmbedBuilder whose .data shape we assert.
 */
import { describe, it, expect } from "vitest";
import { buildUsageEmbed, renderBar } from "../usage-embed.js";
import type { RateLimitSnapshot } from "../../usage/rate-limit-tracker.js";

function snap(overrides: Partial<RateLimitSnapshot>): RateLimitSnapshot {
  return Object.freeze({
    rateLimitType: "five_hour",
    status: "allowed" as const,
    utilization: undefined,
    resetsAt: undefined,
    surpassedThreshold: undefined,
    overageStatus: undefined,
    overageResetsAt: undefined,
    overageDisabledReason: undefined,
    isUsingOverage: undefined,
    recordedAt: Date.now(),
    ...overrides,
  });
}

describe("renderBar (OBS-07)", () => {
  it("renders 50% bar exactly", () => {
    expect(renderBar(0.5)).toBe("▓▓▓▓▓░░░░░ 50%");
  });

  it("renders 0% as all empty", () => {
    expect(renderBar(0)).toBe("░░░░░░░░░░ 0%");
  });

  it("renders 100% as all filled", () => {
    expect(renderBar(1)).toBe("▓▓▓▓▓▓▓▓▓▓ 100%");
  });

  it("renders undefined as 10 dashes + two spaces + n/a", () => {
    // Exact equivalent: "─".repeat(10) + "  n/a"
    expect(renderBar(undefined)).toBe("──────────  n/a");
  });

  it("clamps values >1 to 100%", () => {
    expect(renderBar(1.5)).toBe("▓▓▓▓▓▓▓▓▓▓ 100%");
  });
});

describe("buildUsageEmbed (OBS-07)", () => {
  it("renders 'No usage data yet' description on empty snapshots (Pitfall 7)", () => {
    const e = buildUsageEmbed({ agent: "test", snapshots: [], now: Date.now() });
    expect(e.data.description).toContain("No usage data yet");
    expect(e.data.title).toBe("Usage — test");
  });

  it("color is green when all snapshots allowed", () => {
    const e = buildUsageEmbed({
      agent: "test",
      snapshots: [
        snap({ rateLimitType: "five_hour", status: "allowed", utilization: 0.3 }),
        snap({ rateLimitType: "seven_day", status: "allowed", utilization: 0.5 }),
      ],
      now: Date.now(),
    });
    expect(e.data.color).toBe(3066993);
  });

  it("color is yellow when any allowed_warning (and no rejected)", () => {
    const e = buildUsageEmbed({
      agent: "test",
      snapshots: [
        snap({ rateLimitType: "five_hour", status: "allowed_warning", utilization: 0.85 }),
        snap({ rateLimitType: "seven_day", status: "allowed", utilization: 0.5 }),
      ],
      now: Date.now(),
    });
    expect(e.data.color).toBe(15844367);
  });

  it("color is red when any rejected (overrides allowed_warning)", () => {
    const e = buildUsageEmbed({
      agent: "test",
      snapshots: [
        snap({ rateLimitType: "five_hour", status: "allowed_warning" }),
        snap({ rateLimitType: "seven_day", status: "rejected" }),
      ],
      now: Date.now(),
    });
    expect(e.data.color).toBe(15158332);
  });

  it("renders 4 bar fields in canonical order", () => {
    const e = buildUsageEmbed({
      agent: "test",
      snapshots: [
        // intentionally unordered input — renderer must enforce canonical order
        snap({ rateLimitType: "seven_day_sonnet", status: "allowed", utilization: 0.1 }),
        snap({ rateLimitType: "five_hour", status: "allowed", utilization: 0.2 }),
        snap({ rateLimitType: "seven_day_opus", status: "allowed", utilization: 0.3 }),
        snap({ rateLimitType: "seven_day", status: "allowed", utilization: 0.4 }),
      ],
      now: Date.now(),
    });
    const fieldNames = e.data.fields?.map((f) => f.name) ?? [];
    // Canonical order: five_hour, seven_day, seven_day_opus, seven_day_sonnet
    expect(fieldNames[0]).toContain("5-hour session");
    expect(fieldNames[1]).toContain("7-day weekly");
    expect(fieldNames[2]).toContain("Opus weekly");
    expect(fieldNames[3]).toContain("Sonnet weekly");
  });

  it("renders overage as status-line not bar (Open Q3)", () => {
    const e = buildUsageEmbed({
      agent: "test",
      snapshots: [
        snap({
          rateLimitType: "overage",
          status: "allowed",
          isUsingOverage: true,
          overageStatus: "allowed",
          overageResetsAt: Date.now() + 86_400_000,
        }),
      ],
      now: Date.now(),
    });
    const overageField = e.data.fields?.find((f) => f.name.includes("Overage"));
    expect(overageField).toBeDefined();
    expect(overageField?.value).toContain("using credits");
    // Crucially: NOT a progress bar
    expect(overageField?.value).not.toMatch(/▓+░+/);
  });

  it("renders surpassedThreshold field when defined (Pitfall 9)", () => {
    const e = buildUsageEmbed({
      agent: "test",
      snapshots: [
        snap({
          rateLimitType: "five_hour",
          status: "allowed_warning",
          surpassedThreshold: 0.75,
        }),
      ],
      now: Date.now(),
    });
    const thresholdField = e.data.fields?.find((f) => f.name.includes("Threshold"));
    expect(thresholdField?.value).toContain("75%");
  });

  it("does NOT render threshold field when surpassedThreshold undefined", () => {
    const e = buildUsageEmbed({
      agent: "test",
      snapshots: [snap({ rateLimitType: "five_hour", status: "allowed" })],
      now: Date.now(),
    });
    const thresholdField = e.data.fields?.find((f) => f.name.includes("Threshold"));
    expect(thresholdField).toBeUndefined();
  });

  it("treats rateLimitType:'unknown' gracefully (Pitfall 10)", () => {
    const e = buildUsageEmbed({
      agent: "test",
      snapshots: [snap({ rateLimitType: "unknown", status: "allowed" })],
      now: Date.now(),
    });
    // Unknown types are NOT in TYPE_ORDER and NOT overage — they're silently
    // omitted from the bar grid but the embed still renders (no throw).
    expect(e.data.color).toBe(3066993);
  });

  it("footer contains 'Snapshot age:'", () => {
    const e = buildUsageEmbed({
      agent: "test",
      snapshots: [snap({ rateLimitType: "five_hour", status: "allowed" })],
      now: Date.now(),
    });
    expect(e.data.footer?.text).toContain("Snapshot age:");
  });
});
