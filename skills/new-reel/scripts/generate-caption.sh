#!/bin/bash
# Generate Instagram caption with hashtags for Finmentum reels
# Usage: bash generate-caption.sh <slug> <script_file> <hook_text> [output_dir]
#
# Caption format: hook + 1-2 sentence summary + CTA + disclaimer + hashtags
# NOTE: Full script is NOT included — IG captions are 2,200 char limit; brevity wins.

SLUG="$1"
SCRIPT_FILE="$2"
HOOK_TEXT="$3"
OUTPUT_DIR="${4:-.}"

if [ -z "$SLUG" ] || [ -z "$SCRIPT_FILE" ]; then
    echo "Usage: bash generate-caption.sh <slug> <script_file> <hook_text> [output_dir]"
    exit 1
fi

if [ ! -f "$SCRIPT_FILE" ]; then
    echo "ERROR: Script file not found: $SCRIPT_FILE"
    exit 1
fi

SCRIPT_CONTENT=$(cat "$SCRIPT_FILE")

# ─────────────────────────────────────────────
# Extract key topics for hashtags (no spaces, no leading/trailing artifacts)
# ─────────────────────────────────────────────
TOPIC_HASHTAGS=""
while IFS= read -r topic; do
    [ -z "$topic" ] && continue
    # Collapse spaces, lowercase, prefix with #
    tag=$(echo "$topic" | tr '[:upper:]' '[:lower:]' | tr -s ' ' | tr -d ' ')
    TOPIC_HASHTAGS="${TOPIC_HASHTAGS} #${tag}"
done < <(echo "$SCRIPT_CONTENT" | grep -oiE "(ugma|529|rothira|roth ira|ira|401k|hsa|fsa|credit|savings|investing|budget|debt|tax|financial|money|wealth|retirement|college|education|crypto|stock|etf)" | tr '[:upper:]' '[:lower:]' | sort -u)

# Trim leading space
TOPIC_HASHTAGS="${TOPIC_HASHTAGS# }"

# ─────────────────────────────────────────────
# Build 1-2 sentence summary from first 2 sentences of script
# (strip scene labels like [SCENE 1], timestamps, etc.)
# ─────────────────────────────────────────────
SUMMARY=$(echo "$SCRIPT_CONTENT" \
    | sed 's/\[.*\]//g' \
    | sed 's/^[[:space:]]*//' \
    | grep -v '^$' \
    | head -4 \
    | tr '\n' ' ' \
    | sed 's/[[:space:]]\+/ /g' \
    | cut -c1-200)

# ─────────────────────────────────────────────
# Write caption
# ─────────────────────────────────────────────
cat > "$OUTPUT_DIR/${SLUG}-caption.txt" << EOF
${HOOK_TEXT}

${SUMMARY}

💡 Save this — your future self will thank you.
👇 What money topic should we cover next?

—

⚠️ This content is for educational purposes only and is not financial, investment, or tax advice. Consult a qualified professional for advice specific to your situation.

—

#finmentum #financialeducation #personalfinance #moneytips #wealthbuilding${TOPIC_HASHTAGS:+ $TOPIC_HASHTAGS} #financialfreedom #wealth #retirement #taxtips #budgeting #smartmoney #moneygoals #financialplanning #investment #passiveincome #debtfree #financialindependence #moneytalk #financialliteracy #wealthmindset
EOF

echo "Caption saved to: $OUTPUT_DIR/${SLUG}-caption.txt"
