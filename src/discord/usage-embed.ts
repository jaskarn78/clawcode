/**
 * Phase 103 OBS-07 — pure /clawcode-usage panel renderer.
 *
 * Mirrors the Claude iOS app's session/weekly usage view: 5-hour rolling
 * window, 7-day weekly limit, optional Opus + Sonnet carve-outs, overage
 * state as status-line. Per Research Open Q3 the overage row is rendered
 * as a status-line (not a bar) because it's a credit-pool model, not a
 * percentage.
 *
 * Pure module — accepts plain snapshots, returns EmbedBuilder. Tests
 * construct snapshot literals directly without standing up Discord
 * client. Pattern verbatim from src/discord/sync-status-embed.ts.
 *
 * Color triage matches the operator-surface vocabulary:
 *   - green   (3066993)  — all snapshots `allowed`
 *   - yellow  (15844367) — any `allowed_warning` (and none `rejected`)
 *   - red     (15158332) — any `rejected`
 *
 * Pitfall 9 closure — surpassedThreshold is OPTIONAL NUMBER, not bool;
 * rendered as a separate field when defined.
 *
 * Pitfall 7 closure — empty snapshots render "No usage data yet" rather
 * than an empty embed (graceful for non-OAuth-Max sessions or pre-first-
 * turn agents).
 *
 * Pitfall 10 closure — rateLimitType strings outside the canonical 5-value
 * set (five_hour, seven_day, seven_day_opus, seven_day_sonnet, overage)
 * are silently omitted from the bar grid; the renderer never throws.
 */
import { EmbedBuilder } from "discord.js";
import { formatDistanceToNow } from "date-fns";
import type { RateLimitSnapshot } from "../usage/rate-limit-tracker.js";

const COLOR_HAPPY = 3066993;
const COLOR_WARN = 15844367;
const COLOR_REJECT = 15158332;
const BAR_WIDTH = 10;

const TYPE_ORDER = [
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
] as const;

const TYPE_LABELS: Record<string, string> = {
  five_hour: "5-hour session",
  seven_day: "7-day weekly",
  seven_day_opus: "Opus weekly",
  seven_day_sonnet: "Sonnet weekly",
  overage: "Overage",
};

const STATUS_EMOJI: Record<string, string> = {
  allowed: "🟢",
  allowed_warning: "🟡",
  rejected: "🔴",
};

/**
 * Render a 10-char Unicode progress bar.
 *   utilization=0.5      → "▓▓▓▓▓░░░░░ 50%"
 *   utilization=0        → "░░░░░░░░░░ 0%"
 *   utilization=1        → "▓▓▓▓▓▓▓▓▓▓ 100%"
 *   utilization=undefined → "──────────  n/a"
 *
 * Values >1 clamp to 100%; values <0 clamp to 0%.
 */
export function renderBar(utilization: number | undefined): string {
  if (utilization === undefined) {
    return "─".repeat(BAR_WIDTH) + "  n/a";
  }
  const clamped = Math.max(0, Math.min(1, utilization));
  const filled = Math.round(clamped * BAR_WIDTH);
  const pct = Math.round(clamped * 100);
  return "▓".repeat(filled) + "░".repeat(BAR_WIDTH - filled) + ` ${pct}%`;
}

/**
 * Choose the embed color based on the worst-status across all snapshots.
 * Worst-wins: rejected > allowed_warning > allowed.
 */
function pickColor(snapshots: readonly RateLimitSnapshot[]): number {
  let worst: "allowed" | "allowed_warning" | "rejected" = "allowed";
  for (const s of snapshots) {
    if (s.status === "rejected") return COLOR_REJECT;
    if (s.status === "allowed_warning" && worst !== "rejected") {
      worst = "allowed_warning";
    }
  }
  return worst === "allowed_warning" ? COLOR_WARN : COLOR_HAPPY;
}

function formatReset(resetsAt: number | undefined): string {
  if (resetsAt === undefined) return "unknown";
  return formatDistanceToNow(resetsAt, { addSuffix: true });
}

export type BuildUsageEmbedInput = Readonly<{
  agent: string;
  snapshots: readonly RateLimitSnapshot[];
  now: number;
}>;

export function buildUsageEmbed(input: BuildUsageEmbedInput): EmbedBuilder {
  const { agent, snapshots } = input;
  const embed = new EmbedBuilder().setTitle(`Usage — ${agent}`);

  if (snapshots.length === 0) {
    // Pitfall 7 — graceful "no data" path. Honest message rather than
    // empty embed (operator may be on API-key auth where rate_limit_event
    // never fires).
    embed
      .setColor(COLOR_HAPPY)
      .setDescription(
        "No usage data yet. Either no turns have run since the daemon started, or this session is not authenticated via OAuth Max.",
      );
    return embed;
  }

  embed.setColor(pickColor(snapshots));

  // 4 standard buckets as bars, in canonical order.
  for (const t of TYPE_ORDER) {
    const s = snapshots.find((x) => x.rateLimitType === t);
    if (!s) continue;
    const emoji = STATUS_EMOJI[s.status] ?? "⚪";
    const value = `\`${renderBar(s.utilization)}\` · resets ${formatReset(s.resetsAt)}`;
    embed.addFields({
      name: `${TYPE_LABELS[t]} — ${emoji}`,
      value,
      inline: false,
    });
  }

  // Overage as status-line (Open Q3) — credit pool, not percentage.
  const overage = snapshots.find((x) => x.rateLimitType === "overage");
  if (overage) {
    const overageStateBits: string[] = [];
    if (overage.overageStatus !== undefined) {
      overageStateBits.push(`status: ${overage.overageStatus}`);
    }
    if (overage.isUsingOverage) {
      overageStateBits.push("using credits");
    }
    if (overage.overageDisabledReason !== undefined) {
      overageStateBits.push(`disabled: ${overage.overageDisabledReason}`);
    }
    overageStateBits.push(`resets ${formatReset(overage.overageResetsAt)}`);
    const emoji = STATUS_EMOJI[overage.status] ?? "⚪";
    embed.addFields({
      name: `${TYPE_LABELS.overage} — ${emoji}`,
      value: overageStateBits.join(" · "),
      inline: false,
    });
  }

  // Pitfall 9 — surpassedThreshold rendered as separate field when ANY
  // snapshot just crossed a threshold. Only the most recent crossing.
  const crossed = snapshots.find((s) => s.surpassedThreshold !== undefined);
  if (crossed && crossed.surpassedThreshold !== undefined) {
    const pct = Math.round(crossed.surpassedThreshold * 100);
    embed.addFields({
      name: "⚠ Threshold crossed",
      value: `${crossed.rateLimitType}: just exceeded ${pct}%`,
      inline: false,
    });
  }

  // Footer: oldest snapshot's recordedAt — operator staleness diagnostic.
  const oldestRecordedAt = Math.min(...snapshots.map((s) => s.recordedAt));
  embed.setFooter({
    text: `Snapshot age: ${formatDistanceToNow(oldestRecordedAt, { addSuffix: true })}`,
  });

  return embed;
}
