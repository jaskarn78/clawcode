# Conversation Flow

**Critical rule: Always work scene by scene.** Even if the user provides a complete script upfront, break it into scenes and confirm each one before moving on. Never batch all scenes for bulk approval — lock in each scene's script, avatar position, and b-roll asset individually before proceeding to the next.

---

## Manifest Tracking

> **Manifest-First Rule:** Create the manifest immediately when a reel is named/slugged (Step 1). Never batch-build it right before HeyGen submission.

The manifest (`projects/<slug>-manifest.json`) is created as soon as a slug and title are confirmed, then updated incrementally at each milestone. Each step below notes what gets added. See `reference/manifest-spec.md` for the full schema.

## Step 1: Topic + Voice Calibration
Ask what the reel is about (or accept user's provided topic/script).

Immediately query `published_videos` from the Finmentum DB to load Ramy's actual posted scripts. Show a brief note like: "Loaded 2 reference scripts from Ramy's published videos — calibrating voice match."

If the user provides a full script, acknowledge it but flag: "I'll work through this one scene at a time to lock in each scene before building assets."

**Manifest checkpoint (Step 1):** As soon as the slug and title are locked in (even before the script is written), **create the manifest** at `projects/<slug>-manifest.json` with:
- `slug`, `title`, `status=draft`, `created_at`, `updated_at`

Do this immediately — do not wait until Step 4. This is the manifest-first rule in action.

## Step 2: Content Sourcing
Use `finmentum-content` MCP tools to search the content database:
- `search_content` -- find related videos and transcripts by keyword
- `get_video_details` -- deep-dive into a specific video
- Raw SQL via MCP -- browse `idea_pool` table or run custom queries

Present relevant findings. Let the user pick what to incorporate.

## Step 2.5: Pronunciation Scan

**Hard gate — run on every script, every time.**

After the script is drafted (Step 3 content is ready) and before scene-by-scene lock-in (Step 4), scan for terms that might trip up HeyGen TTS.

Full algorithm is in `reference/pronunciation-scan.md`. Summary:

1. **Fetch glossary:** `GET http://100.117.234.17:5678/webhook/heygen-get-glossary` — extract handled terms
2. **Scan script** for: ALL_CAPS acronyms (2+ chars), proper nouns mid-sentence, financial product names, numbers as digits/symbols, hyphenated compound terms — skip anything already in the glossary
3. **For each flagged term:**
   - Generate TTS of the sentence: POST to `http://100.117.234.17:5678/webhook/heygen-tts-preview`
   - Post to Discord: "⚠️ '[term]' isn't in the brand glossary. Here's how it sounds in context: [audio]. Sound right?"
   - Wait for user response (hard gate per term)
4. **Decision tree:**
   - "Sounds right" → move to next term
   - "Sounds wrong" → ask for correct pronunciation → update glossary (full overwrite — see pronunciation-scan.md) → regenerate TTS to confirm
   - "Add as-is" / "blacklist it" → add to glossary blacklist
5. **Only proceed** past Step 2.5 once ALL flagged terms are confirmed. If zero terms flagged, note "No new pronunciation risks — glossary covers everything" and continue.

> ⚠️ The glossary API **overwrites all entries** on update. Always GET first, merge, then POST the full list. See `reference/pronunciation-scan.md` for the complete update payload.

## Step 3: Full Script Draft (for reference only)
Draft a complete script in Ramy's voice using the reference scripts as calibration. Show the full draft with:
- Word count per scene
- Estimated duration per scene (words / 3.46 = seconds)
- Total estimated duration
- Flag if over 50 seconds — suggest what to cut

This full draft is for orientation only. You will still lock in each scene individually in Step 4.

> **Note on ordering:** Steps 2.5 and 3 are listed in logical dependency order (scan needs a draft), but in practice: draft the script (Step 3 content), then run the pronunciation scan (Step 2.5 logic), then proceed to Step 4. The numbering reflects where the scan sits in the user-facing flow — after content sourcing, before lock-in.

**Manifest checkpoint (Step 3):** Once the script is locked (after pronunciation scan passes), update the manifest:
- `script` (with pronunciation fixes applied), `script_raw` (original), `hook_text`, `word_count`, `estimated_duration_s`

## Step 4: Scene-by-Scene Lock-in (ONE SCENE AT A TIME)

For **each scene**, go through this mini-flow before moving to the next:

**4a. Script confirmation**
Present the scene script. Show word count + estimated duration. Ask: "Happy with this, or want changes?"
Wait for approval before continuing.

**4b. Avatar position**
Recommend a position based on content type:
- Hook/CTA -> `full_screen`
- Data/chart -> `bottom_left_pip`
Ask: "Use [position], or different?"
Wait for approval.

**4c. B-roll decision** (skip for `full_screen` scenes — Path A has no b-roll)
Present options (Path B/C only):
- Option A (Remotion): suggest best-fit template + key props — see `reference/broll-options.md`
- Option B (Pexels): suggest 2-3 search queries (max 3 words each)
Ask: "Option A with [template], Option B with '[query]', or something else?"
Wait for approval.

Show a scene summary card before moving on:
```
Scene [N] locked
   Script: "[first 10 words]..." ([X] words, ~[Y]s)
   Position: bottom_left_pip
   B-roll: Option B — "newborn baby family" + number overlay
```

Only after the user confirms the scene card, move to Scene N+1.

**Manifest checkpoint (Step 4):** After all scenes are locked, **update the manifest** (already created at Step 1) with scene/rendering details:
- `heygen.template_id`, `heygen.brand_voice_id`, `heygen.test`
- `avatar` (full object), `voice` (full object)
- `intro` (full object with `render_props` — ready for Remotion render)
- `outro` (full object with `render_props` — ready for Remotion render)
- `cards` (full array with `render_props` per card — cardType, cardY, durationInFrames, all data props)

## Step 4.5: Floating Card Planning (Path A)

> **Hard rule: Always call `POST http://100.117.234.17:5678/webhook/plan-cards` before suggesting any cards. Manual/inline card planning is fallback only — never first-pass.**

For single-scene reels (Path A — the default), plan the floating card overlays after the script is locked in.

See `reference/card-gallery.md` for the full visual menu of card types.

### 1. Request Card Suggestions (SKIL-01, per D-06)

**Always call the plan-cards webhook first — this is mandatory, not optional.** Do not plan cards manually or inline unless the webhook is confirmed down or returns an error. The fallback inline logic is only for when the endpoint is unreachable (connection refused, timeout, 5xx).

POST to the plan-cards webhook to get AI-suggested cards:

```bash
curl -s -X POST http://100.117.234.17:8765/suggest-cards \
  -H "Content-Type: application/json" \
  --max-time 120 \
  -d '{
    "script": "<full locked script text>",
    "topic": "<topic>",
    "slug": "<slug>"
  }'
```

Expected response: `{ ok: true, cards: [...], reasoning_summary: "..." }`

Each card object in the response contains: `cardId`, `cardType`, `composition_id`, `props` (with `cardY`, `durationInFrames`, data props), `trigger_phrase`, and optionally `isGenerated: true` with a `concept` field.

**Fallback (per D-08) — only when endpoint is down:** If the webhook returns an error (5xx), times out, or is unreachable (connection refused, ETIMEDOUT), fall back to the existing inline card planning logic below. Do NOT use inline planning as a shortcut when the endpoint is reachable. Log the failure to stderr: `"[card-webhook] Webhook unreachable, falling back to inline planning: <error>"`

**Inline fallback logic** (retained ONLY for when webhook/plan-cards is confirmed down):
- Scan script for numbers, comparisons, lists, key stats
- Assign card types using deployed types only: `stat`, `comparison`, `list`, `benefits`, `chart`, `qualifier`, `accumulator`, `freeform`
  - `stat`: single big number
  - `comparison`: two numbers side-by-side
  - `list`: ranked items
  - `benefits`: 3-row value table
  - `chart`: data points over time
  - `qualifier`: eligibility checklist
  - `accumulator`: invest X get Y
  - `freeform`: anything else
- `staticMode: true` on `stat` cards for percentages/text values
- Always include `cardType` in props for caption overlap detection
- Do NOT use `ageComparison`, `stackedTotal`, or `ruleHighlight` (not deployed)
- Assign trigger phrases that exactly match script text
- Present card plan to user for approval (continue to subsection 2 below)

### 2. Present Card Suggestions (SKIL-02, per D-07)

Show the AI-suggested cards to the user with a numbered list:

```
Card suggestions from AI analysis:
1. [stat] "$5.2M" -- triggers on "five point two million" (175 frames)
2. [comparison] "$25/wk vs $50/wk" -- triggers on "fifty dollars a week" (175 frames)
3. [chart] "Growth over 30 years" -- triggers on "thirty years of growth" (200 frames)

AI reasoning: <reasoning_summary from response>

Accept all, or modify? (drop/change/add cards, or "approve")
```

### 3. User Modification Gate (SKIL-03, per D-09/D-10/D-11)

This is a confirmation gate -- do not auto-advance. The user can:

- **Accept all:** User says "approve" or "looks good" -- proceed with the plan as-is
- **Remove cards:** "drop card 2" -- remove that card from the plan array
- **Change card type:** "card 1 should be comparison" -- update cardType and adjust props accordingly
- **Modify props:** "change the headline on card 3 to 'Tax-Free Growth'" -- update specific prop values in-place
- **Add a card:** User describes a new card -- construct the card entry using heuristics:
  - Two numbers = `comparison`
  - Single big number = `stat`
  - Invest X get Y = `accumulator`
  - List of items = `list`
  - Eligibility criteria = `qualifier`
  - If nothing fits existing types, set `isGenerated: true` and capture the user's concept description in the `concept` field

Per D-11: modifications are applied to the plan object in memory. Do NOT re-call the agent for edits -- user modifications are authoritative.

### 4. Generate Novel Cards (SKIL-04, per D-12/D-13)

Before rendering, check for any cards with `isGenerated: true`. For each one, sequentially:

```bash
python3 /home/jjagpal/.openclaw/workspace-general/remotion-banner-dev/scripts/generate-card.py \
  --concept "<card concept description>" \
  --slug "<slug>" \
  --card-id "<cardId>"
```

Per D-12: `generate-card.py` handles tsc validation and manifest registration on the dev container. It must complete successfully before the card can be rendered.

Per D-13: If generation fails (after retry + freeform fallback), the script outputs a freeform fallback JSON. Present the fallback to the user:
```
Card generation failed for "<concept>". Falling back to freeform card:
  [freeform] "<fallback title>" -- <fallback props>
Accept this fallback? (yes/no/modify)
```

After generation, update the card's `composition_id` to the generated component ID (returned by generate-card.py) and remove the `isGenerated` flag. The card is now ready for rendering.

### 5. Render Approved Cards (per D-06 second call)

POST the approved card plan to the render webhook:

```bash
curl -s -X POST http://100.117.234.17:5678/webhook/plan-cards \
  -H "Content-Type: application/json" \
  --max-time 600 \
  -d '{
    "plan": [<approved card objects with composition_id, props, durationInFrames, cardId, cardType>],
    "slug": "<slug>"
  }'
```

Use `--max-time 600` (10 minutes) because sequential rendering of 3 cards at 120s max each can take up to 360s.

Expected response: `{ ok: true, cards: [{ cardId, cardType, rendered_path }, ...] }`

Cards with `error` instead of `rendered_path` failed rendering -- report to user and offer to retry or skip.

### 6. Preview and Final Approval

For each successfully rendered card, use the existing card-preview endpoint to post a Discord preview:

```bash
curl -s http://100.117.234.17:8082/webhook/card-preview \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "cardType": "<type>",
    "props": {<card props>},
    "slug": "<slug>",
    "discord_thread_id": "<thread_id>"
  }'
```

This is a confirmation gate -- wait for user approval before proceeding to Step 5.

**Manifest checkpoint (Step 4.5/Step 5):** After cards are rendered (Step 5):
- Add `file` path (container path) + `md5` checksum to each card entry in the manifest after each Remotion render completes
- `trigger_phrase` must match exact script text for post-processing timing

## Step 5: Intro/Outro
After all scenes are locked, suggest 3 hook titles for the intro card and 3 CTA texts for the outro card. User picks one of each.

## Step 5.5: Pre-Render Verification Gate

Before proceeding past Step 5:

1. **Verify render props match current reel:**
   - Intro: `hookTitle` matches the chosen hook text, `personName` is correct
   - Outro: `ctaLine1` and `ctaLine2` match the chosen CTA text
   - Slug in the render job matches `<current-slug>`

2. **Pixel format check after rendering:**
   ```bash
   ssh root@100.117.234.17 "docker exec finmentum-post ffprobe -v error -select_streams v:0 \
     -show_entries stream=pix_fmt -of csv=p=0 /work/<slug>/intro.mov"
   # Expected: yuva444p12le
   ```
   Repeat for outro. If wrong pixel format: re-render. Do NOT proceed.

3. **Preview frame extraction + Discord post for visual confirmation:**

   **Intro overlay** — extract two frames (post both):
   ```bash
   # Hook text frame (title flash before fade)
   ssh root@100.117.234.17 "docker exec finmentum-post ffmpeg -y -ss 0.1 \
     -i /work/<slug>/intro.mov -frames:v 1 \
     -vf 'colorkey=0x000000:0.01:0.0,pad=1080:1920:0:0:white,scale=540:960' \
     /tmp/intro-hook-check.jpg 2>/dev/null && docker cp finmentum-post:/tmp/intro-hook-check.jpg /tmp/intro-hook-check.jpg"
   scp root@100.117.234.17:/tmp/intro-hook-check.jpg /tmp/intro-hook-check.jpg

   # Banner frame (name/credentials fully animated in)
   ssh root@100.117.234.17 "docker exec finmentum-post ffmpeg -y -ss 3.0 \
     -i /work/<slug>/intro.mov -frames:v 1 \
     -vf 'colorkey=0x000000:0.01:0.0,pad=1080:1920:0:0:white,scale=540:960' \
     /tmp/intro-banner-check.jpg 2>/dev/null && docker cp finmentum-post:/tmp/intro-banner-check.jpg /tmp/intro-banner-check.jpg"
   scp root@100.117.234.17:/tmp/intro-banner-check.jpg /tmp/intro-banner-check.jpg
   ```

   **Outro overlay** — one frame:
   ```bash
   ssh root@100.117.234.17 "docker exec finmentum-post ffmpeg -y -ss 6.0 \
     -i /work/<slug>/outro.mov -frames:v 1 \
     -vf 'colorkey=0x000000:0.01:0.0,pad=1080:1920:0:0:white,scale=540:960' \
     /tmp/outro-check.jpg 2>/dev/null && docker cp finmentum-post:/tmp/outro-check.jpg /tmp/outro-check.jpg"
   scp root@100.117.234.17:/tmp/outro-check.jpg /tmp/outro-check.jpg
   ```

   Post all frames to Discord for visual verification of correct text.

## Step 6: Total Duration Check
Show the full scene breakdown with cumulative timing:
```
Scene 1: [X] words -> ~[Y]s
Scene 2: [X] words -> ~[Y]s
...
Total: ~[T] seconds
```
Target: 40-50 seconds. If over 50s, flag which scenes to trim. Get approval before proceeding.

## Step 7: Background Music

**Hard gate — never skip, never auto-pick.**

### Search and Present 4 Options

1. Search Jamendo for 4 candidate tracks using different tag combos:
   ```bash
   export JAMENDO_CLIENT_ID="495d6d19"
   mkdir -p /tmp/<slug>-music
   bash ${CLAUDE_SKILL_DIR}/scripts/jamendo-music.sh search "<tags1>" <duration> /tmp/<slug>-music/track1.mp3
   bash ${CLAUDE_SKILL_DIR}/scripts/jamendo-music.sh search "<tags2>" <duration> /tmp/<slug>-music/track2.mp3
   bash ${CLAUDE_SKILL_DIR}/scripts/jamendo-music.sh search "<tags3>" <duration> /tmp/<slug>-music/track3.mp3
   bash ${CLAUDE_SKILL_DIR}/scripts/jamendo-music.sh search "<tags4>" <duration> /tmp/<slug>-music/track4.mp3
   ```

2. Post all 4 to Discord (one message each with track name + artist) so the user can listen.

3. **Wait for the user to pick one.** Do not auto-select. Do not proceed without a choice.

Good tag combos for Finmentum:
- `"motivational corporate"` — upbeat, professional
- `"inspirational piano"` — softer, emotional
- `"upbeat lofi"` — modern, relaxed
- `"corporate ambient"` — clean background

### After Selection

4. Delete the 3 rejected tracks: `rm /tmp/<slug>-music/track*.mp3` (except chosen)
5. Move chosen track to `working/<slug>/music.mp3`
6. **Sync music to Unraid** so post-processing can find it:
   ```bash
   # Docker cp required — overlay FS hides files SCP'd to the host bind mount
   scp working/<slug>/music.mp3 root@100.117.234.17:/tmp/music.mp3
   ssh root@100.117.234.17 "docker cp /tmp/music.mp3 finmentum-post:/assets/<slug>/music.mp3 && rm /tmp/music.mp3"
   # Verify: ssh root@100.117.234.17 "docker exec finmentum-post test -f /assets/<slug>/music.mp3 && echo OK"
   ```
   > **Why docker cp?** When `/assets/<slug>/` was created via `docker exec mkdir`, the directory lives on the container's overlay layer. SCP to the host path `/mnt/user/appdata/finmentum-post/assets/<slug>/` goes to the bind mount, which is shadowed by the overlay. Only `docker cp` writes to the visible layer.
7. Note selected track name + artist in the project JSON for attribution.

**Manifest checkpoint (Step 7):** Add `music` object:
- `track_name`, `artist`, `license`
- `jamendo_track_id`, `jamendo_download_url`, `jamendo_share_url` (for re-download if file lost)
- `file` (container path), `volume` (0.04), `fade_out_s` (2.0)

**Note on licensing:** Jamendo free tier tracks are CC-BY-NC. For internal testing and personal review this is fine. For commercial Instagram publishing, either purchase the commercial license on jamendo.com or skip music for that post.

## Step 8: Review
Show a complete project summary:
- Scene table: number, type, position, matting, background type, script preview
- Pronunciation corrections applied (any "Ramy" -> "Rami" replacements)
- Floating card plan (card types, trigger phrases)
- Intro hook title, outro CTA text
- Background music track (name, artist) or "none"
- This is the final checkpoint before asset building — confirm with user.

## Step 8.5: TTS Preview (Full Script Read-Through)

After the Review step is approved, generate TTS audio for the **full script** to verify the complete read-through sounds natural. This is different from the pronunciation scan (Step 2.5) which tested individual flagged terms in isolation.

**Step 2.5 catches individual problem words. Step 8.5 verifies the whole thing flows.**

For each scene:
1. POST to `http://100.117.234.17:5678/webhook/heygen-tts-preview` with the scene script (all pronunciation fixes applied)
2. n8n posts the audio to Discord automatically
3. Wait for user to listen and confirm: "sounds good", "approved", "go ahead", or request changes
4. If pronunciation issues found: update the script text and/or brand glossary, regenerate TTS, repeat
5. Check the `duration` — flag if over 50s (script needs trimming)

**Only after all scenes are approved** proceed to Step 9 (Submit / payload build).

Do NOT set `sceneN_voice` variables in the payload — HeyGen handles voice rendering from the script text.

> ⚠️ TTS preview does NOT apply the brand glossary. To test a glossary substitution, type the phonetic version directly in the TTS text. The actual HeyGen render applies glossary automatically via `brand_voice_id`.

If the user explicitly skips TTS preview: proceed to Step 9. Never auto-skip.

## Step 9: Submit

### Pre-Submit Pipeline Order Check

Before building the HeyGen payload, verify these steps are complete IN ORDER:

```
✅ Step 5 done: All FloatingCard .mov files rendered (Remotion) — verify with:
   ssh root@100.117.234.17 "docker exec finmentum-post ls /work/<slug>/"

✅ Step 6 done: .mov files + music.mp3 synced to /assets/<slug>/ — verify with:
   ssh root@100.117.234.17 "docker exec finmentum-post ls /assets/<slug>/"

✅ Step 7 done: Manifest JSON built with overlays[] array fully populated (non-empty)
   Confirm: cards[], intro{}, outro{} all present with file paths and trigger phrases
```

Build the payload and upload all b-roll assets. Then **STOP** — show a summary table:
- Scene count, types, avatar positions, matting flags
- B-roll asset IDs confirmed uploaded
- Floating card plan (types + trigger phrases)
- Estimated total duration

**Wait for explicit user approval ("submit", "go ahead", "looks good") before calling heygen-submit.sh.**
Never auto-submit. If `$ARGUMENTS` contains `--dry-run`: stop at this step regardless (see Dry Run Mode in SKILL.md).

**Manifest checkpoint (HeyGen submit):** After HeyGen submission:
- Add `heygen.video_id`, `heygen.rendered_at`
- Set `status=rendered` when poll returns `completed`
- Add `heygen.video_url`, `heygen.caption_url`, `heygen.duration_s`
- Add `heygen.video_url_expiry` (URLs expire ~24h from render)

### Manifest POST to Container API

**POST manifest to container API ONLY after all overlay assets are rendered and synced.** Do NOT post immediately after getting the video_id if the overlay assets aren't ready first.

⛔ **CHECKPOINT: Before POSTing manifest to container API, verify:**
- [ ] All FloatingCard .mov files exist in `/assets/<slug>/` — `docker exec finmentum-post ls /assets/<slug>/`
- [ ] `overlays[]` array in manifest is non-empty (has cards[], intro, outro)
- [ ] Each overlay entry has: `type`, `file` (container path), `trigger_phrase` OR `offset`
- [ ] Music file exists at `/assets/<slug>/music.mp3`

**DO NOT POST MANIFEST WITH `overlays:[]` — it will silently produce a reel with no cards.**

```bash
# Verify assets exist before POSTing:
ssh root@100.117.234.17 "docker exec finmentum-post ls /assets/<slug>/"
# Then POST:
curl -s http://100.117.234.17:8082/manifests/<video_id> \
  -X POST -H "Content-Type: application/json" \
  -d @projects/<slug>-manifest.json
```

### Pre-Processing Gate (before post-process-trigger)

After HeyGen render is complete and before triggering post-processing:

1. **Run `reference/pre-flight-checklist.md`** — all 7 checks must pass
2. **Confirm trigger phrases against .ass file:**
   ```bash
   scp root@100.117.234.17:/mnt/user/appdata/finmentum-post/work/<slug>/heygen-captions.ass /tmp/captions.ass
   grep -i "<trigger phrase>" /tmp/captions.ass
   ```
3. **Confirm md5s match rendered files:**
   ```bash
   ssh root@100.117.234.17 "docker exec finmentum-post md5sum /assets/<slug>/*.mov"
   ```
   Each md5 must match the manifest entry for that card.

Only proceed to `post-process-trigger` after all checks pass.

**Manifest checkpoint (post-processing complete):**
- Add `post_processing.last_run_at`, `post_processing.overlay_order`
- Add `output.nextcloud_incomplete`, `output.nextcloud_completed`
- Set `status=post_processed`

**Manifest checkpoint (share URL created):**
- Add `output.share_url`, `output.discord_preview_message_id`
- Set `status=completed`

**Manifest checkpoint (DB push — after Jas approval only):**
- Add `db.published_videos_id`, `db.pushed_at`

**⛔ STOP — Do NOT push to DB yet.** Post the share URL to Jas and wait for explicit approval that the reel is ready to post. Only proceed with the DB insert after approval.

**Push to published_videos DB (after Jas approval only).** Once Jas confirms the reel is ready, insert with the full manifest:

```sql
INSERT INTO published_videos (title, hook_text, script, duration_seconds, platform, published_at, notes, manifest)
VALUES ("<title>", "<hook>", "<script>", <dur>, "instagram", CURDATE(), "<notes>", '<manifest_json>');
```

The `<manifest_json>` value is the contents of `projects/<slug>-manifest.json`.
