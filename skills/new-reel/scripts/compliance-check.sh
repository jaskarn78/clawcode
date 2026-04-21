#!/bin/bash
# Compliance checker for Finmentum scripts
# Usage: bash compliance-check.sh <script_file>
# Exit codes: 0=PASS, 1=WARN, 2=FAIL

SCRIPT_FILE="$1"

if [ -z "$SCRIPT_FILE" ] || [ ! -f "$SCRIPT_FILE" ]; then
    echo "ERROR: Script file not found: $SCRIPT_FILE"
    exit 3
fi

SCRIPT_TEXT=$(cat "$SCRIPT_FILE" | tr '[:upper:]' '[:lower:]')
VIOLATIONS=()
LEVEL="PASS"

# ─────────────────────────────────────────────
# CRITICAL violations — guaranteed returns / fiduciary
# ─────────────────────────────────────────────
CRITICAL_PATTERNS=(
    "guaranteed to make"
    "guaranteed return"
    "will earn you"
    "you'll definitely"
    "surefire way"
    "can't lose"
    "risk-free"
    "no risk"
    "as your fiduciary"
    "i'm a financial advisor"
    "hire me to manage"
    "trust me with your money"
)

for pattern in "${CRITICAL_PATTERNS[@]}"; do
    if echo "$SCRIPT_TEXT" | grep -qi "$pattern"; then
        VIOLATIONS+=("CRITICAL: Found prohibited phrase: '$pattern'")
        LEVEL="FAIL"
    fi
done

# ─────────────────────────────────────────────
# FTC Promotional Content Disclosure (16 CFR Part 255)
# ─────────────────────────────────────────────
if echo "$SCRIPT_TEXT" | grep -qiE "(affiliate|sponsored|paid partnership|#ad\b|promo code|discount code|use my link)"; then
    if ! echo "$SCRIPT_TEXT" | grep -qiE "(#ad|#sponsored|paid partnership|affiliate link|i was paid|compensation received)"; then
        VIOLATIONS+=("CRITICAL: Promotional/affiliate content detected without FTC disclosure. Add '#ad', '#sponsored', or 'Affiliate link in bio'.")
        LEVEL="FAIL"
    fi
fi

# ─────────────────────────────────────────────
# CA SB 577 — Testimonial Standards
# ─────────────────────────────────────────────
if echo "$SCRIPT_TEXT" | grep -qiE "(i made|i earned|my friend made|she made|he made|they made|i turned|turned .* into|paid off .* in|saved .* in)"; then
    if ! echo "$SCRIPT_TEXT" | grep -qiE "(results may vary|not typical|your results|individual results|not a guarantee|may not be typical)"; then
        VIOLATIONS+=("WARNING: Testimonial-style claim without CA SB 577 disclosure. Add: 'Results may vary. This is not typical.'")
        if [ "$LEVEL" == "PASS" ]; then LEVEL="WARN"; fi
    fi
fi

# ─────────────────────────────────────────────
# Investment advice disclaimer
# ─────────────────────────────────────────────
if echo "$SCRIPT_TEXT" | grep -qiE "(invest|return|stock|market|fund|portfolio)"; then
    if ! echo "$SCRIPT_TEXT" | grep -qiE "(not financial advice|not investment advice|educational purposes|consult.*advisor|consult.*professional)"; then
        VIOLATIONS+=("WARNING: Investment content without disclaimer. Add: 'This is not financial advice. Consult a qualified professional.'")
        if [ "$LEVEL" == "PASS" ]; then LEVEL="WARN"; fi
    fi
fi

# ─────────────────────────────────────────────
# Tax advice disclaimer
# ─────────────────────────────────────────────
if echo "$SCRIPT_TEXT" | grep -qiE "(tax|irs|deduction|write-off|taxable|tax-free)"; then
    if ! echo "$SCRIPT_TEXT" | grep -qiE "(not tax advice|consult.*tax|consult.*cpa|consult.*accountant)"; then
        VIOLATIONS+=("WARNING: Tax content without disclaimer. Add: 'This is not tax advice. Consult a tax professional.'")
        if [ "$LEVEL" == "PASS" ]; then LEVEL="WARN"; fi
    fi
fi

# ─────────────────────────────────────────────
# Risk disclosure (crypto, stocks)
# ─────────────────────────────────────────────
if echo "$SCRIPT_TEXT" | grep -qiE "(crypto|bitcoin|ethereum|stock|invest)"; then
    if ! echo "$SCRIPT_TEXT" | grep -qiE "(carry risk|lose money|past performance|risk of loss|not guaranteed)"; then
        VIOLATIONS+=("INFO: Consider adding risk disclosure: 'All investments carry risk. You could lose money.'")
    fi
fi

# ─────────────────────────────────────────────
# Dollar amount promises (broadened regex)
# Catches: $500 will make you, earn $1k, make $2,000, $10K returns
# ─────────────────────────────────────────────
if echo "$SCRIPT_TEXT" | grep -qiP '\$\s*[0-9,]+\s*[kmb]?\s*(will|can|could|to)\s+(make|earn|return|get|grow|give|yield|generate)' \
   || echo "$SCRIPT_TEXT" | grep -qiP '(make|earn|return|get|generate)\s+\$\s*[0-9,]+\s*[kmb]?\b'; then
    VIOLATIONS+=("WARNING: Avoid promising specific dollar amounts. Use 'may' or 'could' instead of 'will'.")
    if [ "$LEVEL" == "PASS" ]; then LEVEL="WARN"; fi
fi

# ─────────────────────────────────────────────
# Output results
# ─────────────────────────────────────────────
echo "=== COMPLIANCE CHECK: $LEVEL ==="
if [ ${#VIOLATIONS[@]} -eq 0 ]; then
    echo "No violations found. Script is compliant."
else
    for v in "${VIOLATIONS[@]}"; do
        echo "• $v"
    done
fi

echo ""
echo "Recommendation: Review reference/compliance-checker.md for full guidelines."

# Exit codes: 0=PASS, 1=WARN, 2=FAIL
case "$LEVEL" in
    PASS) exit 0 ;;
    WARN) exit 1 ;;
    FAIL) exit 2 ;;
    *)    exit 3 ;;
esac
