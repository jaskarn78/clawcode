# FloatingCard Gallery

Visual menu of all FloatingCard types. Use this when planning which cards to show during a reel.

All cards render as white floating panels at `cardY: 1100` (lower-third area). Cards animate in with a fade, play their animation, then fade out. Pixel format: `yuva444p12le` (ProRes 4444 with alpha).

> **Typography rule (non-negotiable):** Minimum font size in any card is **20px**. No label, subtext, caption, or secondary text should ever go below 20px. Main values and headings should be 28px or larger.

> **Note:** When no existing card type fits the visual concept well, prefer dynamic card generation (`cardType: "freeform"` with a `concept` field) over forcing data into a mismatched template. See [Dynamic Generated Cards](#dynamic-generated-cards) below.

---

## Stat Card
**cardType:** `stat`

**Use when:** You have one big number that's the hero of the scene.

**Looks like:** Large animated counter in the center of a white floating card. The number counts up from zero to its final value. A teal sparkline animates below the number. Subtitle text sits underneath for context.

**Example:** "$5.2M projected growth" — appears when Ramy says "five point two million dollars"

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `statValue` | string | yes | Display value with formatting ($, %, K, M) |
| `statValueNumeric` | number | yes | Raw number for counter animation. Set 0 for non-numeric values |
| `statChange` | string | no | Delta badge ("+5.0%", "-$200", "+$547K") |
| `statSubtext` | string | yes | One-line context below the number |
| `statPositive` | boolean | yes | true=green styling, false=red |
| `staticMode` | boolean | no | Set `true` for percentages or text that shouldn't count up |

---

## Comparison Card
**cardType:** `comparison`

**Use when:** You're showing a before-vs-after or two options side by side.

**Looks like:** Two columns on a white card. Left column shows one value, right column shows another. Both have labels above and animated counters that count up simultaneously. A subtext line runs across the bottom for context.

**Example:** "$25/week vs $100/week savings" — appears when Ramy contrasts two contribution levels

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `leftLabel` | string | yes | Column header for left side |
| `leftValueNumeric` | number | yes | Raw integer — card formats with $ and commas |
| `leftSubtext` | string | no | Context below left value |
| `rightLabel` | string | yes | Column header for right side |
| `rightValueNumeric` | number | yes | Raw integer |
| `rightSubtext` | string | no | Context below right value |
| `comparisonSubtext` | string | no | Shared context line below both columns |

> ⚠️ Always pass `leftValueNumeric` and `rightValueNumeric` as raw integers (e.g. `50000`, not `"$50K"`). The counter animation reads these — defaults to 0 if omitted.

---

## List Card
**cardType:** `list`

**Use when:** You have a ranked or ordered set of items (up to 5).

**Looks like:** White card with a title at the top and up to 5 rows. Each row slides in with a stagger animation — rank number on the left, label in the middle, value on the right.

**Example:** "Top 5 tax-advantaged accounts" — appears when Ramy lists account types in order

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `listTitle` | string | yes | Title above the list |
| `listItems` | array | yes | Max 5 items. Each: `{rank: number, label: string, value: string}` |
| `listItems[].value` | string | no | Optional right-side value (dollar amount, etc). Empty string if none |

---

## Benefits Card
**cardType:** `benefits`

**Use when:** You're highlighting 3 key advantages or features in a table format.

**Looks like:** White card with 3 rows that slide in one at a time. Each row has a bold value on the left and a descriptor on the right. Optional small subtext under the value.

**Example:** "0% tax on gains / No RMDs / $7,000/yr limit" — appears when listing Roth IRA benefits

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `benefitsRows` | array | yes | 2-4 rows. Each: `{value: string, valueSubtext?: string, description: string}` |
| `benefitsRows[].value` | string | yes | Bold left column (short: "$19K", "Tax-Free", "0%") |
| `benefitsRows[].description` | string | yes | Right column explanation |

---

## Chart Card
**cardType:** `chart`

**Use when:** You want to show a trend line — stock performance, growth over time, market data.

**Looks like:** White card with a title, a ticker symbol badge, and the current value at the top. Below is an animated line chart that draws itself from left to right. X-axis labels along the bottom.

**Example:** "S&P 500 — 10-year growth" — appears when Ramy discusses market returns

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `chartTitle` | string | yes | Title above chart |
| `chartTicker` | string | no | Badge text (stock ticker, index name) |
| `chartCurrentValue` | string | no | Current value display |
| `chartDataPoints` | number[] | yes | Y-values. Chart self-scales. Must match chartLabels length |
| `chartLabels` | string[] | yes | X-axis labels. Must match chartDataPoints length |

> ⚠️ Always pass `chartDataPoints` — empty array shows a "No data" message.

---

## Accumulator Card
**cardType:** `accumulator`

**Use when:** You're showing investment math — "put in X per month, get Y after Z years."

**Looks like:** White card with the contribution amount and period at the top (e.g. "$200/mo for 30 years"). A growth rate badge sits below. The hero is a large animated counter at the bottom that counts up to the final accumulated value.

**Example:** "$200/mo → $1.2M after 40 years at 10%" — appears during compound interest explanations

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `contributionAmount` | string | yes | Display string ("$500/mo", "$6,000/yr") |
| `contributionNumeric` | number | yes | Raw periodic amount |
| `period` | string | yes | Time horizon ("30 years", "until age 65") |
| `growthRate` | string | yes | Assumed rate ("10%", "7% avg") |
| `accFinalValue` | string | yes | Display string for final value |
| `accFinalValueNumeric` | number | yes | Raw number for counter animation |

---

## Age Comparison Card
**cardType:** `ageComparison`

**Use when:** You're comparing outcomes based on starting age — "start at 25 vs start at 35."

**Looks like:** White card split into two columns. Left column shows the early starter (age, label, and result with counter animation). Right column shows the late starter. A difference callout at the bottom highlights the gap between outcomes.

**Example:** "Start at 25: $1.1M vs Start at 35: $540K — $560K difference" — appears during age-based planning discussions

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `earlyAge` | number | yes | Starting age for early scenario |
| `earlyLabel` | string | yes | Column label |
| `earlyResult` | string | yes | Display string |
| `earlyResultNumeric` | number | yes | Raw number for animation |
| `lateAge` | number | yes | Starting age for late scenario |
| `lateLabel` | string | yes | Column label |
| `lateResult` | string | yes | Display string |
| `lateResultNumeric` | number | yes | Raw number for animation |
| `ageDifference` | string | yes | Gap display string |
| `ageDifferenceNumeric` | number | yes | Raw gap number |
| `ageDifferenceLabel` | string | yes | Callout text below |

---

## Stacked Total Card
**cardType:** `stackedTotal`

**Use when:** Multiple line items sum up to a grand total.

**Looks like:** White card with a title at the top and multiple rows that slide in with a stagger. Each row has a label and an animated counter value. At the bottom, a bold total row appears last with its own counter animation.

**Example:** "HSA + 401k + Roth IRA = $30,500 total annual tax-advantaged space" — appears when Ramy adds up contribution limits

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `stackTitle` | string | yes | Title above items |
| `stackItems` | array | yes | Each: `{label: string, value: string, valueNumeric: number}` |
| `totalLabel` | string | yes | Usually "Total" |
| `totalValue` | string | yes | Display string |
| `totalValueNumeric` | number | yes | Must equal sum of item valueNumerics |

---

## Qualifier Card
**cardType:** `qualifier`

**Use when:** You're showing eligibility criteria — who qualifies and who doesn't.

**Looks like:** White card with a title and a checklist of items. Each item slides in with either a green checkmark (eligible) or a red X (not eligible). A footnote at the bottom provides additional context.

**Example:** "Who qualifies for a Roth IRA?" — appears when discussing income limits and filing status

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `qualifierTitle` | string | yes | Title above the checklist |
| `qualifierItems` | array | yes | Each: `{label: string, eligible: boolean}`. true=green check, false=red X |
| `qualifierFootnote` | string | no | Small text at bottom (recommended for tax/legal topics) |

---

## Rule Highlight Card
**cardType:** `ruleHighlight`

**Use when:** There's a surprising rule, little-known feature, or regulation worth spotlighting.

**Looks like:** White card with a large emoji at the top, a bold title, and a body of text that reveals word by word with a typewriter animation. A source attribution sits at the bottom in small text.

**Example:** "🏦 You can withdraw Roth contributions at ANY time — tax and penalty free" — appears when Ramy drops a surprising rule

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `ruleEmoji` | string | yes | Contextual emoji (📋 rules, ⚠️ warnings, 💰 money, 🏦 banking, 📅 deadlines) |
| `ruleTitle` | string | yes | Bold headline |
| `ruleText` | string | yes | Body text (typewriter animation) |
| `ruleSource` | string | no | Attribution (adds credibility for IRS/legal) |

---

## dualColumn

**cardType:** `dualColumn`

**Use when:** Comparing two sets of parallel data side by side — e.g. single vs married filing jointly tax brackets, two-scenario income comparisons.

**Looks like:** White card with a teal title at the top, column headers (teal, underlined), and a 7-row table. Bracket label (10%, 12%, etc.) anchors the left edge; left column values animate in from the left, right column values animate in from the right with a slight delay. Alternating row backgrounds add visual rhythm.

**Example:** "2025 TAX BRACKETS — SINGLE vs MFJ" — appears when Ramy walks through how tax brackets differ for single vs married filers.

**Props:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `dualColumnTitle` | string | yes | Card headline (e.g. "2025 TAX BRACKETS") |
| `dualColumnLeftHeader` | string | yes | Left column header (e.g. "SINGLE") |
| `dualColumnRightHeader` | string | yes | Right column header (e.g. "MFJ") |
| `dualColumnLabels` | string[] | yes | Row labels on left edge (e.g. ["10%","12%","22%",...]) |
| `dualColumnLeft` | string[] | yes | Left column values, same length as labels |
| `dualColumnRight` | string[] | yes | Right column values, same length as labels |

---

## Dynamic Generated Cards

When the visual concept doesn't fit any of the 10 template types above, use **dynamic card generation** to create a custom TSX component from scratch.

### When to Use Dynamic vs Existing Templates

| Fit Quality | Signal | Action |
|-------------|--------|--------|
| **High** | Data maps cleanly to an existing card's props (e.g., one hero number → `stat`, two values → `comparison`) | Use the existing template |
| **Medium** | Data *could* fit a template but would require blank props, awkward labels, or misleading layout | Consider dynamic — the visual will be clearer |
| **Low** | No template matches the concept (multi-tier data, custom layout, interactive-style visual, unique structure) | Use dynamic generation |

### How It Works

In the card plan output, set `cardType: "freeform"` and include a `concept` field describing the visual:

```json
{
  "cardType": "freeform",
  "concept": "Tax bracket waterfall — 6 tiers showing progressive rates with filled bars proportional to taxable income in each bracket",
  "durationInFrames": 210,
  "cardY": 1100
}
```

The pipeline handles it as follows:

1. **`generate-card.py`** reads the card plan and detects `cardType: "freeform"`
2. **`card-generator` agent** is spawned — it designs and writes a new TSX component tailored to the concept
3. The new component is saved to the Remotion project and registered in the manifest
4. The card renders via a `TaxBracketCard`-style composition ID (named after the concept)
5. Output is the same ProRes 4444 `.mov` with alpha — composited in post-processing like any other card

### Example Use Cases

- **Tax bracket waterfall** — progressive rate tiers with proportional filled bars
- **Portfolio allocation** — pie/donut chart with labeled segments and percentages
- **Multi-step calculator** — chain of inputs → intermediate results → final output
- **Timeline / milestone tracker** — horizontal or vertical timeline with key dates
- **Decision tree** — branching paths showing "if X then Y" logic
- **Custom comparison matrix** — 3+ columns or rows beyond what `comparison` supports
- **Stacked bar breakdown** — e.g., where your paycheck goes (taxes, rent, savings, discretionary)

### Key Points

- Dynamic cards follow the same render pipeline — ProRes 4444, alpha channel, `cardY: 1100`, fade in/out
- The `concept` field should be specific enough for the agent to design the layout without ambiguity
- Prefer existing templates when the fit is high — they're battle-tested and render faster
- Dynamic generation adds a design + code-gen step, so allow extra time in the workflow

---

## Sequential Multi-Card Renders

When two or more cards would appear close together in the script (or back-to-back), combine them into a **single dynamic render** instead of separate overlays.

### Why

- Sidesteps the minimum gap enforcement between overlay files
- Cleaner timeline — one asset, one trigger point
- Smoother viewer experience — no dead screen between cards

### How It Works

Use `cardType: "freeform"` with a `concept` that describes **both** cards as sequential content within one render:

```json
{
  "cardType": "freeform",
  "concept": "Sequential two-card render: Card A (chart: 529 growth over 18 years → $35K) animates in for 7s then fades out. Card B (qualifier checklist: 4 requirements for 529→Roth rollover) immediately animates in for 8s then fades out. Same cardY: 1100, same width/size constraints. Total duration covers both display windows.",
  "durationInFrames": 375,
  "cardY": 1100
}
```

The `durationInFrames` should cover: Card A duration + Card B duration (no gap needed between them).

### When to Use

- Two cards that appear within ~5 seconds of each other in the script
- Cards covering related concepts that flow naturally together
- Any time the gap enforcement rule would create awkward dead screen time

### When NOT to Use

- Cards are far apart in the script (>10 seconds between triggers) — keep as separate overlays
- Cards have very different visual weights that would look jarring back-to-back
- More than 3 cards in sequence — split into two sequential renders instead
