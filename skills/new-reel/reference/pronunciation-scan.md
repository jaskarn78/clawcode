# Pronunciation Scan (Step 2.5)

Auto-scan the script for terms that might trip up HeyGen TTS. This runs **before** the full TTS preview (Step 8.5) and catches individual terms early — so the full read-through is clean on the first try.

## When to Run

After the script is drafted (Step 3) and before scene-by-scene lock-in (Step 4). Every script, every time. No exceptions.

---

## Scan Algorithm

### 1. Fetch the Current Brand Glossary

```bash
curl -s http://100.117.64.85:5678/webhook/heygen-get-glossary
```

Returns the current vocabulary (terms with phonetic overrides), blacklist (pronounce naturally), and tones. Extract the list of handled terms — these are already covered and can be skipped.

### 2. Scan the Script for Flaggable Terms

Flag any term matching these patterns that is **NOT** already in the glossary:

| Pattern | Examples | Why It's Risky |
|---------|----------|----------------|
| ALL_CAPS acronyms (2+ chars) | ABLE, FICA, APY | TTS may spell out or mispronounce |
| Proper nouns (capitalized mid-sentence) | Vanguard, Schwab, Fidelity | May get wrong stress or pronunciation |
| Financial product names | Medi-Cal, CalABLE, Roth IRA | Compound terms with unusual capitalization |
| Numbers as digits or symbols | $23K, 10%, 401k, $1.2M | TTS may say "dollar sign twenty-three K" |
| Hyphenated compound terms | tax-advantaged, pre-tax, after-tax | May get split or stressed wrong |

**Skip:** Common English words, terms already in the glossary vocabulary or blacklist, and numbers that are already written out in words in the script.

### 3. For Each Flagged Term — Generate and Verify

For each flagged term:

**a. Generate a TTS clip of the sentence containing it:**

```bash
curl -s http://100.117.64.85:5678/webhook/heygen-tts-preview \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "text": "<full sentence containing the term>",
    "voice_id": "749758e687a94ec6bd68374824938237",
    "speed": "1.0",
    "scene": "pronunciation-check"
  }'
```

n8n posts the audio to Discord automatically.

**b. Post the flag to Discord:**

```
⚠️ '[term]' isn't in the brand glossary. Here's how it sounds in context: [audio posted above]. Sound right?
```

**c. Wait for user response** — this is a hard gate per term.

### 4. Decision Tree

| User Says | Action |
|-----------|--------|
| **"Sounds right"** / **"that's fine"** | No action needed. Move to next term. |
| **"Sounds wrong"** | Ask: "How should it be pronounced?" Then update glossary (see below) and regenerate TTS to confirm. |
| **"Add it as-is"** / **"blacklist it"** | Add to glossary blacklist (HeyGen pronounces naturally, no override). |

### 5. Gate

Only proceed past Step 2.5 once **ALL** flagged terms are confirmed. If zero terms are flagged, note "No new pronunciation risks found — glossary covers everything" and move on.

---

## Glossary Update Process

### ⚠️ CRITICAL: Full Overwrite

The glossary API **overwrites all entries** on every update. You must:

1. **GET** the current glossary first
2. **Merge** your changes into the full list
3. **POST** the complete updated list

Never POST just the new entries — you'll delete everything else.

### Update Payload

```bash
# Step 1: GET current state
CURRENT=$(curl -s http://100.117.64.85:5678/webhook/heygen-get-glossary)

# Step 2: Merge new entries into existing vocabulary/blacklist
# (programmatically — add new [term, phonetic] pairs to vocabulary array,
#  or add new terms to blacklist array)

# Step 3: POST the FULL updated glossary
curl -s http://100.117.64.85:5678/webhook/heygen-update-glossary \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "vocabulary": [
      ["Ramy", "Rami"],
      ["UGMA", "U-G-M-A"],
      ["SSI", "S-S-I"],
      ["CalABLE", "Cal-ABLE"],
      ["IRA", "I-R-A"],
      ["Roth IRA", "Roth I-R-A"],
      ["401k", "four-oh-one-k"],
      ["ETF", "E-T-F"],
      ["HSA", "H-S-A"],
      ["FSA", "F-S-A"],
      ["NEW_TERM", "phonetic-spelling"]
    ],
    "blacklist": ["DM", "Finmentum", "NEW_NATURAL_TERM"],
    "tones": ["professional", "friendly", "conversational"]
  }'
```

### After Updating

Regenerate the TTS clip for the affected sentence to confirm the fix sounds right. Only move on after user confirms.

---

## Relationship to Step 8.5 (Full TTS Preview)

| Step | Scope | Purpose |
|------|-------|---------|
| **2.5 — Pronunciation Scan** | Individual flagged terms | Catch and fix problem words before locking the script |
| **8.5 — TTS Preview** | Full script read-through | Verify the complete audio sounds natural end-to-end |

Step 2.5 handles the surgical fixes. Step 8.5 is the final listen before submit. Both are hard gates — never skip either.

> **Note:** TTS preview (`POST /v1/audio/text_to_speech`) does NOT apply the brand glossary. To test how a glossary substitution will sound in Step 2.5, type the phonetic substitution directly in the TTS text. The actual HeyGen render applies glossary automatically via `brand_voice_id`.
