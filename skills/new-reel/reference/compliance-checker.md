# Script Compliance Checker

Financial education content must comply with California state and federal regulations. Run this check before every HeyGen submission.

## Required Checks

### 1. Investment Advice Disclaimer
**Rule:** Must include disclaimer if discussing investments, returns, or performance.

**Required text (one of):**
- "This is not financial advice. Consult a qualified professional."
- "For educational purposes only. Not investment advice."
- "This content is for information only. Speak with a financial advisor."

**Placement:** Hook or within first 15 seconds, OR in outro/CTA.

### 2. Guaranteed Returns Prohibition
**Rule:** Cannot promise or guarantee specific returns.

**Flagged phrases:**
- "guaranteed to make"
- "will earn"
- "you'll definitely get"
- "surefire way to"
- "can't lose"
- "risk-free returns"

**Allowed alternatives:**
- "historically has returned"
- "on average"
- "may earn"
- "potential to grow"
- "past performance"

### 3. Fiduciary Claim Verification
**Rule:** Cannot claim to be a fiduciary or registered advisor unless licensed.

**Flagged phrases:**
- "as your fiduciary"
- "I'm a financial advisor"
- "trust me with your money"
- "hire me to manage"

**Allowed:**
- "I'm sharing what I've learned"
- "here's what works for me"
- "consider this approach"

### 4. Testimonial Standards (CA SB 577)
**Rule:** Testimonials must be typical and disclose material connections.

**Required if using testimonials:**
- "Results may vary"
- "This is not typical"
- "Your results may differ"

### 5. Tax Advice Disclaimer
**Rule:** Tax content must include disclaimer.

**Required text:**
- "This is not tax advice. Consult a tax professional."
- "Tax laws change. Speak with a CPA."

### 6. Risk Disclosure
**Rule:** Must disclose risks for investment-related content.

**Required for:** Stocks, crypto, real estate, business ventures.

**Required text:**
- "All investments carry risk. You could lose money."
- "Past performance doesn't guarantee future results."

### 7. Promotional Content Disclosure (FTC)
**Rule:** Must disclose paid partnerships, affiliate links, sponsored content.

**Required text:**
- "#ad" or "#sponsored"
- "Paid partnership"
- "Affiliate link in bio"

## Auto-Check Process

Run before Step 9 (HeyGen submission):

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/compliance-check.sh working/<slug>/script.txt
```

Returns: `PASS`, `WARN`, or `FAIL` with specific violations.

### Exit Codes (for automation / CI)

| Exit Code | Meaning |
|-----------|--------|
| `0` | PASS — no violations |
| `1` | WARN — issues present but submittable with acknowledgment |
| `2` | FAIL — critical violations; **do not submit** |
| `3` | ERROR — script file not found or bad args |

```bash
bash compliance-check.sh script.txt
case $? in
  0) echo "Good to go" ;;
  1) echo "Warn — review before submitting" ;;
  2) echo "FAIL — fix script first" ;;
esac
```

## Manual Review Checklist

- [ ] No guaranteed return claims
- [ ] Investment advice disclaimer present (if applicable)
- [ ] Tax advice disclaimer present (if applicable)
- [ ] Risk disclosure present (if applicable)
- [ ] No fiduciary/RIA claims
- [ ] No specific dollar amounts promised as outcomes
- [ ] Testimonials marked as atypical (if used)
- [ ] Promotional relationships disclosed (if applicable)

## Severity Levels

| Level | Action |
|-------|--------|
| **CRITICAL** | Script cannot be submitted. Fix required. |
| **WARNING** | Can submit with user acknowledgment. |
| **INFO** | Best practice suggestion. |

## Common Finmentum Scenarios

**UGMA/529 accounts:** ✅ Generally safe. No disclaimers needed unless promising growth amounts.

**Roth IRA contributions:** ⚠️ WARNING zone. Must include "not tax advice" if discussing tax benefits.

**Stock market returns:** ⚠️ WARNING zone. Must use "historically" or "on average," not "will earn."

**Crypto:** 🔴 CRITICAL. High risk disclosure required.

**Credit card strategies:** ✅ Generally safe. No disclaimers needed for basic education.

## Reference

- SEC Investment Advisers Act of 1940
- California Corporations Code Section 25230
- FTC Endorsement Guides (16 CFR Part 255)
- CA SB 577 (Testimonial regulations)
