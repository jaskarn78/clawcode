---
name: new-reel
description: Create a new Instagram Reel video through conversational workflow -- from topic to HeyGen render. Use when starting a new reel, making a video, or working on reel content. Triggers on "new reel", "new video", "make a reel", "working on a new reel", "/new-reel". Covers script writing, scene planning, b-roll asset prep, HeyGen payload construction, submission, polling, and post-processing handoff.
---

# New Reel Skill

Guide the user from topic ideation to a submitted HeyGen render. This is the **front-half** of the pipeline:
conversation -> project JSON -> asset prep -> upload -> payload build -> submit -> poll -> download.

**Post-processing** (intro/outro overlays, music mixing, caption burn-in) is handled by the **finmentum-post container on Unraid** (`http://100.117.234.17:8082`, GPU-accelerated). Trigger via n8n or direct container API — never run FFmpeg or Remotion locally.

The project JSON saved to `projects/<slug>.json` serves as both audit trail and pipeline input.

## Reference Files

| File | When to Read |
|------|-------------|
| `reference/conversation-flow.md` | Full 9-step conversation workflow — read before starting any reel |
| `reference/compliance-checker.md` | CA and federal financial regulations compliance guide — read before submitting any reel |
| `reference/broll-options.md` | Remotion templates, StockFootageOverlay chartTypes, zoneBContent, Pexels workflow |
| `reference/manifest-spec.md` | Reel manifest JSON schema — source of truth for every reel's metadata |
| `reference/manifest-example.json` | Complete filled-in manifest example (UGMA-style single-scene reel) |
| `reference/post-processing.md` | Full post-processing pipeline: captions, overlays, music mix, Nextcloud upload |
| `reference/card-gallery.md` | FloatingCard type gallery + dynamic generation guide — read when planning cards |
| `reference/ffmpeg-recipes.md` | Battle-tested FFmpeg cheatsheet — colorkey, overlay timing, audio mixing, fade recipes |
| `reference/payload-example.json` | Complete 4-scene HeyGen v2 payload example |
| `reference/project-schema.json` | ProjectJSON schema for validation |

## Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/heygen-upload.sh` | Upload assets to HeyGen | `bash ${CLAUDE_SKILL_DIR}/scripts/heygen-upload.sh <file> video` |
| `scripts/heygen-submit.sh` | Submit payload to HeyGen | `bash ${CLAUDE_SKILL_DIR}/scripts/heygen-submit.sh working/<slug>/payload.json` |
| `scripts/heygen-poll.sh` | Poll render status | `bash ${CLAUDE_SKILL_DIR}/scripts/heygen-poll.sh <video_id> working/<slug>` (run with `run_in_background: true`) |
| `scripts/pexels-download.sh` | Search + download stock footage | `bash ${CLAUDE_SKILL_DIR}/scripts/pexels-download.sh search "<query>" <min_dur> working/<slug>/pexels-scene<N>.mp4` |
| `scripts/jamendo-music.sh` | Search + download background music | `bash ${CLAUDE_SKILL_DIR}/scripts/jamendo-music.sh search "<tags>" <dur_secs> working/<slug>/music.mp3` |
| `scripts/upload-cache.sh` | Cache uploaded asset IDs | `get <file_path>` / `set <file_path> <url> <asset_id>` |
| `scripts/compliance-check.sh` | Check script compliance with CA/federal regs | `bash ${CLAUDE_SKILL_DIR}/scripts/compliance-check.sh working/<slug>/script.txt` — exit 0=PASS, 1=WARN, 2=FAIL; **result is saved to manifest** under `compliance.level` |
| `scripts/generate-caption.sh` | Generate IG caption with hashtags | `bash ${CLAUDE_SKILL_DIR}/scripts/generate-caption.sh <slug> <script_file> "<hook_text>" <output_dir>` |

## Environment Setup

```bash
source /home/jjagpal/.openclaw/workspace-general/finmentum/.env
```

Required env vars: `HEYGEN_API_KEY`, `PEXELS_API_KEY`. Optional: `JAMENDO_CLIENT_ID` (defaults to `495d6d19`).

Default avatar ID (hardcoded — do not use env var): `d46fa7f3801f413d943120285050d6ed` (Finmentum Ramy Main - Prod, talking_photo).

Remotion project: Runs on Unraid container at `/work/remotion-banner`. Do NOT run Remotion locally.

Python venv / finmentum_studio.py: **Legacy — no longer used.** Post-processing is handled by the Unraid container.

Jamendo client ID: `export JAMENDO_CLIENT_ID="495d6d19"`

## Avatar Position Registry

Canvas: **1080 x 1920** (9:16 portrait)

| Position | Scale | Offset X | Offset Y | Matting | Use When |
|----------|-------|----------|----------|---------|----------|
| `full_screen` | 1.0 | 0.0 | 0.0 | false | Hook/intro, direct-to-camera, CTA |
| `half_screen_split` | 1.0 | 0.25 | 0.0 | false | Side-by-side with text/graphics |
| `bottom_left_pip` | 0.45 | -0.29 | 0.32 | **true** | B-roll with avatar bottom-left |
| `bottom_right_pip` | 0.45 | 0.29 | 0.32 | **true** | B-roll with avatar bottom-right |
| `top_left_pip` | 0.45 | -0.29 | -0.32 | **true** | B-roll with avatar top-left |
| `top_right_pip` | 0.45 | 0.29 | -0.32 | **true** | B-roll with avatar top-right |

**Rules:**
- Corner PIP positions ALWAYS require `"matting": true` in the character object.
- Always use `"play_style": "fit_to_scene"` for all positions (Jas's explicit preference).
- Always use `video_asset_id` (NOT `url`) for video backgrounds — avoids pillarboxing bug.
- **Instagram default:** Use `bottom_left_pip` (NOT `bottom_right_pip`). Instagram's like/comment/share UI is anchored to the right side.
- **`use_avatar_iv_model: true` on ALL character objects.** Avatar IV = better gestures, expressions, lip sync.

## Canonical Name/Credentials Banner (Never Changes)

The intro and outro always display Ramy's name and title exactly as follows. Do not guess, abbreviate, or vary this:

| Field | Value |
|-------|-------|
| `personName` | `Ramy Hindiyeh, Ph.D., MBA` |
| `personTitle` | `Principal Investment Advisor at Finmentum` |

Use these exact strings in every `render_props` for `IntroOverlay` and `OutroOverlay`. No exceptions.

---

## Default Avatar

**Avatar ID: `d46fa7f3801f413d943120285050d6ed`** (Finmentum Ramy Main - Prod — Talking Photo)

Use this ID for ALL reels. Apply as follows depending on API path:

**Video API** (`video_inputs[].character`):
```json
{
  "type": "avatar",
  "avatar_id": "d46fa7f3801f413d943120285050d6ed",
  "use_avatar_iv_model": true
}
```

**Template API** (`variables.scene1_avatar`):
```json
"scene1_avatar": {
  "name": "scene1_avatar",
  "type": "character",
  "properties": {
    "character_id": "d46fa7f3801f413d943120285050d6ed",
    "type": "talking_photo"
  }
}
```

Include `scene1_avatar` in every template payload — don't rely on the template default.

## Pronunciation Map

> **Note:** With `brand_voice_id` in the payload, all glossary-handled terms below are automatically substituted by HeyGen TTS. Do NOT manually replace these terms in `input_text` when using `brand_voice_id`. The table below is kept for reference — it shows what the glossary does, not what you need to do manually.

Glossary-handled terms (automatic via `brand_voice_id`):

| Written | Spoken (for TTS) |
|---------|-----------------|
| Ramy | Rami |
| DM | DM (blacklisted — HeyGen pronounces naturally as two letters) |
| UGMA | U-G-M-A |
| Roth IRA | Roth I-R-A |
| SSI | S-S-I |
| CalABLE | Cal-ABLE |
| 401(k) | four-oh-one-k |
| IRA | I-R-A |
| ETF | E-T-F |
| HSA | H-S-A |
| FSA | F-S-A |

Case-sensitive. Apply to every scene script before building the payload.

**Glossary-handled terms** (no need to fix in input_text — HeyGen applies automatically):
Ramy → Rami, UGMA, SSI, CalABLE, IRA, Roth IRA, 401k, ETF, HSA, FSA, DM (blacklisted — natural), Finmentum (blacklisted — natural)

**Still fix manually in input_text** (not in glossary, or needs explicit control):
- Numbers: always write out in full ("nineteen thousand" not "$19K")
- Em dashes: remove always
- Novel acronyms not in glossary: add phonetic spelling

**Note on spelling:** "Ramy" (not "Rami") is the correct spelling in the script — the pronunciation map above converts it to "Rami" for TTS only.

**Pronunciation scan (every script):** Before building payload, scan for: acronyms (SSI, IRA, ETF, UGMA, HSA, FSA), brand names (CalABLE, Finmentum), initialisms, numbers written as digits, em dashes, and any novel/compound words. Apply phonetic fixes in `input_text` only — captions come from HeyGen's ASS file and will reflect actual speech.

**HeyGen Brand Glossary:** Available at `GET /v1/brand_voice/list` and `POST /v1/brand_voice/{id}`.
- Glossary is pre-configured with Finmentum vocabulary (see pronunciation map above).
- Terms in the glossary are handled automatically by HeyGen TTS — no need to phonetically spell them in `input_text`.
- To update the glossary: POST to `http://100.117.234.17:5678/webhook/heygen-update-glossary` with `{vocabulary, blacklist, tones}`.
- To view current glossary: GET `http://100.117.234.17:5678/webhook/heygen-get-glossary`.
- **Note:** Updating vocabulary overwrites ALL entries. Always include the full list. Reference the pronunciation map above as the source of truth.
- Brand Voice ID: `ba58de0a05e9424c853ecbb2ce1032ee`
- The `brand_voice_id` field is supported in the template generate payload (v2 endpoint: `POST /v2/template/{template_id}/generate`). Include it at the top level alongside `template_id`, `caption`, `test`, etc.

## Ramy's Voice — Reference Scripts

Before writing any script, query `published_videos` to load Ramy's actual voice patterns:

```python
import pymysql
conn = pymysql.connect(host='100.117.234.17', port=3306, user='jjagpal', password=<pw>, database='finmentum')
cur = conn.cursor()
cur.execute("SELECT title, hook_text, script, duration_seconds FROM published_videos ORDER BY created_at DESC LIMIT 10")
```

Calibration targets:
- **Sentence length:** Short, declarative. No sub-clauses.
- **Hook pattern:** Surprising fact or "Did you know..." — creates immediate disbelief
- **"Most people" contrast:** What average person does wrong, then pivot to smart move
- **Numbers spoken out loud:** "seventeen point seven million" not "$17.7M"
- **No jargon without instant translation:** Define financial terms in the same breath
- **CTA format:** "DM me" is the default. "Send me a DM" is also acceptable. Both are in use. Don't over-engineer it.
- **Total duration:** Target 40-50 seconds. At 3.46 words/second, that's 138-173 words total.

### Script Style Rules (Non-Negotiable)

- **No em dashes. Ever. In anything.** Scripts, captions, card text, all output. Use a period, comma, or reword. Hard rule from Ramy. No exceptions. Search every script and caption for `—` before delivery.
- **Short declarative sentences.** No sub-clauses, no run-ons.
- **Numbers spoken out loud:** "twenty-three thousand" not "$23K"
- **"DM me"** is fine as a CTA. Default to it.
- **Always spell "Ramy" correctly in the script** — never "Rami". The brand glossary converts "Ramy" → "Rami" for TTS pronunciation only. Captions are generated from the script text verbatim, so "Rami" in the script = "Rami" in the caption = visible typo in the published video. Pre-submission check: grep for "Rami " in the script and reject if found.

## Conversation Flow

Follow the 10-step flow in `reference/conversation-flow.md`. Summary:

1. **Topic + Voice Calibration** — load reference scripts from DB
2. **Content Sourcing** — search content DB via MCP tools
3. **Full Script Draft** — for orientation, with word counts and timing
4. **Scene-by-Scene Lock-in** — ONE AT A TIME: script -> position -> b-roll -> confirm card (card suggestions via `POST http://100.117.234.17:5678/webhook/plan-cards` — sidecar endpoint is mandatory first pass)
5. **Render FloatingCards** — Remotion renders on Unraid → .mov files (MUST happen before manifest POST)
6. **Sync Assets** — copy .mov + music to /assets/<slug>/ on Unraid container
7. **Build Manifest** — with overlays[] array FULLY populated (non-empty)
8. **Intro/Outro + Review** — 3 hook title options, 3 CTA options, final checkpoint
8.5. **TTS Preview** — generate voice audio via n8n, share with user, wait for approval
9. **Submit to HeyGen** — upload assets, show summary, wait for explicit approval; THEN POST manifest to container API
10. **Webhook auto-triggers post-processing** when HeyGen render completes

**Critical ordering rule:** Steps 5 and 6 (card renders + asset sync) MUST complete before the manifest is POSTed to the container API in Step 9. An empty overlays:[] manifest causes silent post-processing failure — no cards appear in the final video.

**Step 6 — Sync assets to /assets/<slug>/ (CRITICAL):** After every Remotion render, copy the .mov file from /work/ to /assets/ using `docker exec cp`. SCP to the host bind-mount path will NOT work (overlay filesystem hides writes).
```bash
# Create assets dir if needed:
ssh root@100.117.234.17 "docker exec finmentum-post mkdir -p /assets/<slug>/"
# Copy each rendered card:
ssh root@100.117.234.17 "docker exec finmentum-post cp /work/<slug>/<card>.mov /assets/<slug>/<card>.mov"
# Verify:
ssh root@100.117.234.17 "docker exec finmentum-post ls -la /assets/<slug>/"
```
Do this for EACH card, intro, and outro immediately after it renders. Then copy music (see Step 7).

## Remotion Asset Usage — Three Paths

**This is the most important architectural decision for each reel. Pick the path before building the payload.**

### Path A: 1-Scene Template (most common Finmentum reels)

Use when: single scene, avatar talks full-screen for full duration.

- **HeyGen payload:** Template API, 1-scene template (`83dfa706c8144b4b9033d0d154ad6ebd`). Background set in template — no Remotion in the payload.
- **Remotion assets uploaded to HeyGen:** ❌ None.
- **Floating cards:** Rendered as ProRes 4444 `.mov` → composited in post-processing only.
- **Workflow:**
  1. Write script → build template payload (`scene1_script` + `scene1_avatar` only)
  2. After HeyGen render → post-processing container composites Remotion cards via FFmpeg

### Path B: Multi-Scene Template (3, 4, or 5 scenes)

Use when: multiple scenes, each with its own b-roll background (chart, stock footage, etc.).

Templates available:
| Scenes | Template ID |
|--------|-------------|
| 3 | `ab097f97972e4bfb90c4af28f551e57b` |
| 4 | `2f27f8bfd8024155a5af7839a4ad6372` |
| 5 | `4122c9505431433fa2b0cc8f265efa3d` |

- **HeyGen payload:** Template API with scene background variables. Remotion renders for each scene → uploaded as `video_asset_id` → passed as template background variables (e.g., `scene2_background`, `scene3_background`).
- **Remotion assets uploaded to HeyGen:** ✅ Scene backgrounds only. Run through upload cache.
- **Floating cards:** Still composited in post-processing — never in the HeyGen payload.
- **Workflow:**
  1. For each scene needing a Remotion background: render locally → upload → cache `video_asset_id`
  2. Build template payload with `sceneN_script`, `sceneN_avatar`, `sceneN_background` variables
  3. After HeyGen render → post-processing container composites any floating card overlays

### Path C: Video API (multi-scene, non-template)

Use when: full control needed over scene layout, positions, or timing that templates don't support.

- Same as Path B but uses `video_inputs[]` instead of template variables.
- Remotion backgrounds uploaded as `video_asset_id` per scene.
- Floating cards still composited in post-processing.

### Decision Rule

| Signal | Path |
|--------|------|
| 1 scene, full-screen avatar, floating data cards as overlays | **Path A** — no uploads |
| Multiple scenes, each with distinct b-roll or chart backgrounds | **Path B** — upload Remotion per scene |
| Floating stat/comparison/summary card overlaid *on top of* avatar | Any path — card always goes in post-processing |
| Custom scene layouts not supported by templates | **Path C** |

**Floating cards always go in post-processing. Never in the HeyGen payload — for any path.**

---

## Payload Construction

Build the HeyGen payload based on the path chosen above.

### Path A — Template Payload

```json
{
  "template_id": "83dfa706c8144b4b9033d0d154ad6ebd",
  "brand_voice_id": "ba58de0a05e9424c853ecbb2ce1032ee",
  "caption": true,
  "test": true,
  "title": "<slug>",
  "variables": {
    "scene1_script": {
      "name": "scene1_script",
      "type": "text",
      "properties": { "content": "<script with Ramy→Rami applied>" }
    },
    "scene1_avatar": {
      "name": "scene1_avatar",
      "type": "character",
      "properties": {
        "character_id": "d46fa7f3801f413d943120285050d6ed",
        "type": "talking_photo"
      }
    }
  }
}
```

> **No `sceneN_voice` variables** — HeyGen renders voice from the script text. TTS preview is for pronunciation verification only, not as a voice source.

Always include `scene1_avatar` to override the template default.

### Path B — Video API Payload

1. **Skeleton:** `{"title": "<slug>", "dimension": {"width": 1080, "height": 1920}, "video_inputs": []}`

2. **For each scene**, build a `video_input` with:
   - **Character:** `type: "avatar"`, `avatar_id: "d46fa7f3801f413d943120285050d6ed"`, scale/offset from position registry, `use_avatar_iv_model: true`. Add `"matting": true` for corner PIP.
   - **Voice:** `type: "text"`, voice_id, `input_text` (with Ramy->Rami applied).
   - **Background:** Color `{"type": "color", "value": "#FFFFFF"}` or Remotion render `{"type": "video", "video_asset_id": "<id>", "play_style": "fit_to_scene"}`.

3. **For Remotion backgrounds** (Path B scenes with animated graphics):
   - Submit `render_and_upload` job to Unraid container (see Remotion Asset Rendering section below)
   - Use returned `asset_id` as `video_asset_id` in the background object (NEVER `url` — causes pillarboxing)

4. Write payload to `working/<slug>/payload.json`.

Validate project JSON against `reference/project-schema.json` before saving to `projects/<slug>.json`.

## Post-Processing Pipeline

Post-processing runs on the finmentum-post container (Unraid, `http://100.117.234.17:8082`). It handles ALL overlay compositing — regardless of whether HeyGen was called with the template or video API.

**Floating cards (stat, comparison, summary, etc.) are ALWAYS composited here — not in HeyGen.**

**Three-pass assembly — do not collapse into fewer passes:**

| Pass | Step | Audio |
|------|------|-------|
| Pass 1 | Intro overlay only (capped at **4 seconds**) | `-c:a copy` |
| Pass 2 | Floating cards + outro + music mix (single FFmpeg pass) | `-c:a aac -b:a 192k` |
| Pass 3 | Burn .ass captions LAST — on top of everything including cards | `-c:a copy` |

**Captions must burn last (Pass 3).** Previously captions burned in Pass 1 and cards composited in Pass 2, so cards rendered on top of captions. The 3-pass order ensures captions are always visible above all overlays.

Using `-c:a copy` on Pass 1 and Pass 3 means audio is only encoded once (in Pass 2). Multiple AAC encode cycles cause audible quality degradation — avoid at all costs.

See `reference/post-processing.md` for the full shell commands and all variable substitutions.
See `reference/ffmpeg-recipes.md` for the individual FFmpeg building blocks.

### Nextcloud Auth (WebDAV)

**Jas's account (pipeline storage):** Password lives in the finmentum-post container env — no 1Password needed at runtime:

```bash
NC_PASS=$(ssh root@100.117.234.17 "docker exec finmentum-post env" | grep NEXTCLOUD_PASSWORD | cut -d= -f2)

curl -u "jjagpal:${NC_PASS}" -T render.mp4 \
  "https://storage.jjagpal.me/remote.php/dav/files/jjagpal/Finmentum reels/Incomplete/<slug>.mp4"
```



### Nextcloud Public Share (always create after Completed upload)

```bash
NC_PASS=$(ssh root@100.117.234.17 "docker exec finmentum-post env" | grep NEXTCLOUD_PASSWORD | cut -d= -f2)

SHARE_URL=$(curl -s -u "jjagpal:${NC_PASS}" \
  -X POST \
  "https://storage.jjagpal.me/ocs/v2.php/apps/files_sharing/api/v1/shares" \
  -H "OCS-APIRequest: true" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "path=/Finmentum reels/Completed/<slug>-FINAL.mp4" \
  -d "shareType=3&permissions=1" | python3 -c "
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.stdin).getroot()
url = root.find('.//url')
print(url.text if url is not None else 'ERROR')
")

# Post to Discord: "✅ <slug> done! 📥 Full quality: ${SHARE_URL}"
```

- `shareType=3` = public link, `permissions=1` = read-only
- **Always create a public share link immediately after every Completed upload — mandatory, not optional.**
- Post share URL to Discord so Jas can download full quality: the URL from `<url>` in the XML response is the public shareable link
- Save share URL to manifest under `output.share_url`

## Caption Pipeline

Captions are enabled by default (`"caption": true` in the HeyGen payload). When enabled, HeyGen returns:

| Artifact | Description | Used? |
|----------|-------------|-------|
| `video_url` | Clean video without captions | Yes — base video |
| `video_url_caption` | Video with HeyGen's default captions | No |
| `caption_url` | `.ass` subtitle file with word-level timing | Yes — restyled locally |

The pipeline (Stage 11) handles everything automatically via `restyle_and_burn_captions()`:
- Restyles `.ass` to Finmentum brand (Montserrat Bold 28pt, white text, #A1FCCD highlight)
- Adds `\kf` karaoke tags — highlights the currently spoken word in bright gold (#F5D020), dim white for already-spoken words
- Burns captions onto the video via FFmpeg

**CRITICAL: ASS PlayRes headers.** `restyle_ass_captions()` MUST output `PlayResX: 1080` and `PlayResY: 1920` in the `[Script Info]` header. Without these, libass uses the 640x480 default and font scaling breaks — text overflows the frame. If you ever touch caption restyling code, verify these headers are present.

## Upload Workflow (Path B and C only)

**Only applies when using multi-scene templates (Path B) or Video API (Path C) — scene background assets that go into HeyGen.**
Path A (single-scene template): skip this section entirely.
Floating cards, intro/outro overlays → post-processing only, never uploaded to HeyGen regardless of path.

### Option 1: n8n Upload (PREFERRED for container-rendered assets)

```bash
# Upload a rendered asset to HeyGen via n8n (returns asset_id synchronously)
curl -s http://100.117.234.17:5678/webhook/heygen-asset-upload \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "file_path": "/output/<slug>/<name>.mov",
    "asset_type": "video"
  }'
# Response: {"asset_id": "...", "url": "...", "status": "ok", "source": "container"}
# Use asset_id as video_asset_id in HeyGen payload
```

The n8n workflow delegates to the finmentum-post container for `file_path` uploads (efficient — no binary through n8n). For remote `file_url` uploads, it downloads and uploads directly to HeyGen.

Note: `render_and_upload` on the container already handles render+upload in one shot — use the n8n upload workflow only for pre-rendered files that need uploading separately.

### Option 2: Local upload via script

For each Remotion b-roll background asset:
1. Check cache: `bash ${CLAUDE_SKILL_DIR}/scripts/upload-cache.sh get <file_path>`
2. If miss, upload: `bash ${CLAUDE_SKILL_DIR}/scripts/heygen-upload.sh <file_path> video`
3. Cache result: `bash ${CLAUDE_SKILL_DIR}/scripts/upload-cache.sh set <file_path> <url> <asset_id>`
4. Use `video_asset_id` in the background object (NOT `url` — causes pillarboxing).

**HeyGen upload rules:**
- Always use `scripts/heygen-upload.sh` or the n8n workflow — do NOT curl manually.
- Correct endpoint: `upload.heygen.com/v1/asset` (NOT `api.heygen.com`)
- Auth header: `X-Api-Key` (NOT `X-HEYGEN-API-KEY`)

## Reel Manifest

Every reel **MUST** have a manifest saved to `projects/<slug>-manifest.json`. The manifest is the **single source of truth** for:

- Re-running post-processing (FFmpeg composite) without touching HeyGen
- Re-running the full pipeline from HeyGen render through post-processing
- Reproducing any floating card from scratch (re-render in Remotion)
- Reproducing the intro/outro from scratch (re-render in Remotion)
- Re-downloading music if the file is lost
- Auditing exactly what was used 3 months from now

**Full schema and field documentation:** `reference/manifest-spec.md`
**Complete example:** `reference/manifest-example.json`

> **Manifest-First Rule:** Create the manifest immediately when a reel is named/slugged (Step 1). Never batch-build it right before HeyGen submission.

### Incremental Manifest Updates

The manifest is created the moment a slug and title are locked in, then updated at each milestone. The `render_props` object for each card, intro, and outro must be **complete** — containing everything needed to re-render that asset in Remotion without any other context.

### When to Save / Update

| Milestone | Fields to update |
|-----------|------------------|
| **Step 1 (slug + title locked)** | **Create manifest:** `slug`, `title`, `status=draft`, `created_at`, `updated_at` |
| Step 3 (script locked) | Add `script`, `script_raw`, `hook_text`, `word_count`, `estimated_duration_s` |
| Step 4 (scene lock-in complete) | Add `heygen.*` (template_id, brand_voice_id, test), `avatar`, `voice`, `intro` (full object with `render_props`), `outro` (full object with `render_props`), `cards` (full array with `render_props` per card) |
| Cards rendered (Step 5) | Add `file` path + `md5` checksum to each card entry after each render completes |
| Music selected (Step 7) | Add `music` (full object including `jamendo_*` fields for re-download) |
| HeyGen submitted (Step 9) | Add `heygen.video_id`, set `status=submitted`, POST manifest to container API |
| HeyGen poll complete (post-render) | Add `heygen.video_url`, `heygen.caption_url`, `heygen.video_url_expiry`, `heygen.duration_s`, set `status=rendered` |
| Post-processing complete | Add `post_processing`, `output.nextcloud_incomplete`, `output.nextcloud_completed`, set `status=post_processed` |
| Share URL created | Add `output.share_url`, set `status=completed` |
| DB push (after user approval) | Add `db.published_videos_id`, `db.pushed_at` |

**Always update `updated_at` on every write.**

### Save Location

```
workspace-finmentum-studio/finmentum/projects/<slug>-manifest.json
```

### Script-Fix Re-Render (Correcting a Published Reel)

When re-rendering a reel for a script-only fix (e.g. spelling correction, pronunciation fix):

**DO change:**
- `heygen.video_id` → new video ID from re-submission
- `heygen.rendered_at` → null
- `heygen.video_url` / `caption_url` → null (will be populated after render)
- `script` → corrected text
- `output.nextcloud_*` → new output paths if needed (e.g. `calable-reel-v2-FINAL.mp4`)
- `status` → "submitted"

**DO NOT change:**
- `slug` — asset paths are keyed to the original slug
- All overlay `file` paths — cards/intro/outro still live at `/assets/<original-slug>/`
- `music.file` — still at `/assets/<original-slug>/music.mp3`
- `cards[].render_props` — no re-renders needed for script-only fix
- `intro`/`outro` render_props

> ⚠️ Changing the slug breaks post-processing — container looks for assets at `/assets/<new-slug>/` which doesn't exist. Preserve the original slug in the manifest even if the HeyGen title is different.

**After updating manifest:** Re-register with new video_id:
```bash
curl -s http://100.117.234.17:8082/manifests/<new_video_id> \
  -X POST -H "Content-Type: application/json" \
  -d @projects/<slug>-manifest.json
```

### Re-running Post-Processing

> **WARNING:** HeyGen `video_url` expires within ~24 hours. Before re-triggering post-processing, ALWAYS re-fetch via `heygen-poll` using the stored `video_id`.

If post-processing needs to be re-run:

1. Load the manifest from `projects/<slug>-manifest.json`
2. Re-fetch fresh HeyGen URLs via `heygen-poll` using `heygen.video_id`
3. Update `heygen.video_url`, `heygen.caption_url`, `heygen.video_url_expiry` in the manifest
4. Build the `post-process-trigger` payload from manifest fields
5. Trigger post-processing
6. Update `post_processing.last_run_at`

### Re-rendering a Card

If a card needs to be re-rendered:

1. Load the manifest
2. Find the card in the `cards` array
3. Use the `render_props` object exactly as-is to submit a Remotion render job
4. Update `card.file` path and `card.md5` after render completes
5. Re-run post-processing with updated card

---

## Publishing to DB

**Only push to `published_videos` after Jas has explicitly verified the final video is ready to post.** Never auto-push on post-processing completion.

**Gate:** Show the final share URL → wait for explicit approval ("looks good", "approved", "push to db", etc.) → then INSERT.

When approved, always include the full manifest JSON in the `manifest` column. The manifest comes from `projects/<slug>-manifest.json`.

**INSERT (new reel):**
```sql
INSERT INTO published_videos (title, hook_text, script, duration_seconds, platform, published_at, notes, manifest)
VALUES ("<title>", "<hook>", "<script>", <dur>, "instagram", CURDATE(), "<notes>", '<manifest_json>');
```

**UPDATE (backfill existing row):**
```sql
UPDATE published_videos SET manifest = '<manifest_json>' WHERE id = <id>;
```

---

## Pipeline Step Ordering (Non-Negotiable)

The following order MUST be followed for every reel. Skipping or reordering these steps causes silent post-processing failure (empty overlays, no cards in final video):

```
Step 3: Script locked, pronunciation scan done
Step 4: Scene plan finalized — card types, timing, trigger phrases
Step 5: Render FloatingCards (Remotion) → .mov files on Unraid container
Step 6: Sync .mov + music to /assets/<slug>/ on Unraid container
Step 7: Build manifest JSON WITH overlays array fully populated
Step 8: Submit HeyGen → get video_id
Step 9: POST manifest (with overlays) to http://100.117.234.17:8082/manifests/<video_id>
Step 10: Webhook auto-triggers post-processing on render complete
```

**Cards MUST be rendered and synced BEFORE the manifest is POSTed to the container API.**
A manifest with `overlays: []` will be accepted silently but post-processing will produce a reel with no cards.

---

## Compliance Check (Step 8.6 — Required Before Submission)

Before submitting to HeyGen, run the compliance checker to ensure the script meets CA and federal financial regulations:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/compliance-check.sh working/<slug>/script.txt
```

**If FAIL:** Fix violations before proceeding. See `reference/compliance-checker.md` for guidance.
**If WARN:** Can proceed with user acknowledgment.
**If PASS:** Proceed to submission.

Common issues to flag:
- Guaranteed returns ("will earn", "guaranteed") → CRITICAL
- Missing investment advice disclaimer → WARNING
- Missing tax advice disclaimer → WARNING
- Fiduciary claims without license → CRITICAL

## Instagram Caption Generation (Production Renders Only)

For production renders (`test: false`), auto-generate the IG caption with hashtags:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/generate-caption.sh <slug> working/<slug>/script.txt "<hook_text>" working/<slug>/
```

This creates `working/<slug>/<slug>-caption.txt` with:
- **First line (mandatory):** `For educational purposes only. Not financial, investment, or tax advice.`
- Hook text + body copy in caption form
- Max 5 hashtags
- Standard Finmentum hashtags

**Caption format rule (non-negotiable):** The disclaimer MUST be the very first line of every Instagram caption. No exceptions. Ramy has explicitly required this on every post.

**Post-processing delivery:** The caption file should be included alongside the final video in Nextcloud.

## Manifest Validation (Required Before HeyGen Submission)

After building the manifest JSON and before submitting to HeyGen, run this check. If any item fails, stop and fix before proceeding:

1. **overlays** — `cards` array has at least one intro + one card + one outro (non-empty)
2. **file paths** — all overlay `file` values are container paths (`/assets/<slug>/filename.mov`)
3. **trigger phrases** — each floating card has `trigger_phrase` OR an explicit `offset` (not both empty)
4. **music** — `music.file` points to `/assets/<slug>/music.mp3`
5. **output** — `output.nextcloud_incomplete`, `output.nextcloud_completed`, and `output.filename` are all set (missing `filename` crashes process.py)
6. **compliance** — run `compliance-check.sh` and resolved any FAILs

Do NOT proceed to HeyGen submission with a manifest that fails any of these checks.

---

## Submission and Webhook-Based Completion

1. **Save project JSON** to `projects/<slug>.json` (validated against schema).
2. **Submit via direct HeyGen API** (NOT n8n — n8n `heygen-template-generate` returns empty body with no video_id):
```bash
source /home/jjagpal/.openclaw/workspace-general/finmentum/.env
curl -s -X POST "https://api.heygen.com/v2/template/83dfa706c8144b4b9033d0d154ad6ebd/generate" \
  -H "X-Api-Key: ${HEYGEN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d @working/<slug>/payload.json
# Response: {"data": {"video_id": "..."}, "error": null}
```
Parse `data.video_id` from the response. If the response has no `video_id`, do not proceed.
3. **POST manifest to container API ONLY after all overlay assets are rendered and synced.** The manifest must have a complete overlays[] array. An empty overlays:[] manifest will cause silent post-processing failure.
   ```bash
   # All card .mov files must already exist in /assets/<slug>/ before running this
   # Verify: ssh root@100.117.234.17 "docker exec finmentum-post ls /assets/<slug>/"
   # Update manifest with video_id first, then POST:
   curl -s http://100.117.234.17:8082/manifests/<video_id> \
     -X POST -H "Content-Type: application/json" \
     -d @projects/<slug>-manifest.json
   ```
   This must happen within minutes of submission — HeyGen renders can complete quickly. Without this, the webhook fires and finds no manifest, skipping post-processing.
4. **Inform user:** "Render submitted! Video ID: {id}. Manifest saved — post-processing will auto-trigger when done."
5. **ALWAYS poll manually and trigger post-processing manually.** HeyGen webhook delivery is unreliable for ALL renders (especially test renders). Never wait passively for the webhook to fire — it may never arrive.
   ```bash
   # Poll every 30s until status === "completed"
   curl -s http://100.117.234.17:5678/webhook/heygen-poll \
     -X POST -H "Content-Type: application/json" \
     -d '{"video_id": "<video_id>"}'
   # When status=completed, trigger post-processing manually:
   curl -s http://100.117.234.17:5678/webhook/post-process-trigger \
     -X POST -H "Content-Type: application/json" \
     -d '{"video_id": "<video_id>", "slug": "<slug>", "heygen_video_url": "<video_url from poll>", "heygen_caption_url": "<caption_url from poll>"}'
   ```
   The webhook + poll fallback run in the background as a safety net, but manually triggering post-processing after polling is the guaranteed path. Do NOT wait for Discord notification before confirming completion.
7. **Include caption file for production renders:** Ensure `working/<slug>/<slug>-caption.txt` is uploaded to Nextcloud alongside the final video.

### Webhook Architecture

```
HeyGen render completes
  → HeyGen POSTs to https://jjagpal.me/webhook/heygen-webhook-receiver
  → n8n fetches FRESH video_url + caption_url via GET /v1/video_status.get (REQUIRED)
  → n8n triggers post-processing on finmentum-post container (if manifest present)
  → Discord notification posted
```

> **Manifest save is REQUIRED immediately after HeyGen submission.** The container now has `/manifests/<video_id>` endpoints. Save the manifest using the video_id returned by HeyGen — this is what the webhook uses to auto-trigger post-processing. See "Manifest Save Step" below.

**⚠️ Critical:** HeyGen's webhook payload contains the CAPTIONED video URL, not the clean video. Always fetch fresh URLs via `GET /v1/video_status.get?video_id=<id>` — the n8n webhook workflow does this automatically via the "Fetch HeyGen Video Status" node. Never use the webhook `video_url` directly or captions will be double-burned.

HeyGen webhook endpoint ID: `9009808908fc4157bb1958e9c0917867` (old: `50dbe0b217af49a3bf6641da2a376602`)
Events: `avatar_video.success`, `avatar_video.fail`, `avatar_video_caption.success`, `avatar_video_caption.fail`
n8n workflow: `HeyGen Webhook Receiver` (ID: `Gvzo8KsU3SqJWzRh`)

> ⚠️ **HeyGen webhook delivery is unreliable**, especially for test renders (`test: true`). The `heygen-poll-fallback` n8n workflow runs automatically after every render submission and is the primary completion mechanism. See n8n webhooks section below.

## Post-Processing Trigger (Unraid Container)

After HeyGen render completes, trigger post-processing. **Always use n8n** — never call the container directly.

```bash
curl -s http://100.117.234.17:5678/webhook/post-process-trigger \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "slug": "<slug>",
    "heygen_video_url": "<video_url from heygen-poll response>",
    "heygen_caption_url": "<caption_url from heygen-poll response>",
    "overlays": [
      {"name":"intro","file":"/assets/<slug>/intro.mov","type":"intro","exit_by":4},
      {"name":"stat-card","file":"/assets/<slug>/stat-card.mov","type":"card","trigger_phrase":"<spoken phrase>","duration":7,"fade":true},
      {"name":"outro","file":"/assets/<slug>/outro.mov","type":"outro","offset_from_end":5}
    ],
    "music": {"file_path": "/assets/<slug>/music.mp3", "volume": 0.04},
    "output": {
      "nextcloud_incomplete": "Finmentum reels/Incomplete/<slug>.mp4",
      "nextcloud_completed": "Finmentum reels/Completed/<slug>-FINAL.mp4",
      "filename": "<slug>-FINAL.mp4"
    }
  }'
# Returns immediately: {"message": "Workflow was started"}
# ⚠️ After this call completes, poll the container job and also MANUALLY trigger post-processing
# after polling HeyGen shows status=completed (do not rely on webhook auto-trigger).
# n8n polls container every 30s, posts to Discord on success/error.
```

Returns immediately with `{"message": "Workflow was started"}`. n8n polls the container, uploads to Nextcloud, and posts Discord notification automatically.

**Overlay files** must exist at `/assets/<slug>/` inside the container (= `/mnt/user/appdata/finmentum-post/assets/<slug>/` on Unraid).
- For floating cards rendered by the container: submit `render_asset` job first (see below).
- For pre-built `.mov` files (intro/outro): sync to Unraid before triggering post-processing.

**Before triggering post-processing, run through `reference/pre-flight-checklist.md`.**

**Trigger phrases** must exactly match what Ramy says in the script (check the `.ass` caption file). Wrong phrases default to sequencing after the previous card — use caption file to verify.

**Field aliasing (v4+):** The container accepts both camelCase and snake_case field names.
`heygen_video_url` and `video_url` both work. `composition_id` and `template` both work.
No need to worry about exact field naming -- Pydantic AliasChoices handles both.

**Structured errors (v4+):** The /webhook/process endpoint returns structured error objects:
`{"status": "error", "error_type": "validation_error|preflight_error|...", "detail": "...", "retryable": true|false}`
n8n can use `retryable` to decide whether to retry automatically.

**Container pre-flight (v4+):** The container now runs its own pre-flight validation before starting FFmpeg:
- Checks overlays are not empty
- Verifies overlay files exist and have correct pixel format (yuva444p)
- Confirms music file exists if specified
- Validates FFmpeg filter chain (format=yuva444p before colorkey, threshold=0.01)
The manual pre-flight checklist is still recommended but the container catches these errors automatically with clear messages.

**Automatic gap enforcement (container handles this):**
- Minimum gap between card exit and next card start: **0.5s**
- Maximum gap between card exit and next card start: **7.0s** — cards are pushed forward if a gap would exceed this (no dead screen time)
- Last card targets a **3.0s gap** before outro — pushed toward the outro if it ends too early
- All rules applied by `enforce_no_overlap()` in the container — no manual timing adjustments needed

## Remotion Asset Rendering (Unraid GPU)

All Remotion renders happen on the Unraid container — NOT locally. Submit as `render_asset` or `render_and_upload` jobs.

**⚠️ Serial renders only.** Never submit multiple render jobs simultaneously — the GPU cannot handle concurrent Remotion renders. Submit one job, poll until `status: ok`, then submit the next.

```bash
# Render only (for overlays used in post-processing)
curl -s http://100.117.234.17:8082/webhook/process \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "type": "render_asset",
    "slug": "<slug>",
    "composition_id": "<TemplateName>",
    "props": { <template props> },
    "duration_frames": 175,
    "fps": 25,
    "format": "prores_4444",
    "output": "<name>.mov"
  }'

# Render + upload to HeyGen (for Path B scene backgrounds)
curl -s http://100.117.234.17:8082/webhook/process \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "type": "render_and_upload",
    "slug": "<slug>",
    "composition_id": "<TemplateName>",
    "props": { <template props> },
    "duration_frames": 175,
    "fps": 25,
    "format": "prores_4444",
    "output": "<name>.mov"
  }'

# Poll until done
curl -s http://100.117.234.17:8082/jobs/<job_id>
```

`render_and_upload` returns `asset_id` in the response — use directly as `video_asset_id` in HeyGen payloads.

Output files are at `/work/<slug>/<name>.mov` inside the container. For post-processing overlays, copy to `/assets/<slug>/` so the post-processing job can find them.

**Render format note:** The container uses `--prores-profile=4444 --image-format=png --pixel-format=yuva444p10le` internally. `--image-format=png` is required for true alpha — without it, Remotion renders JPEG frames (no alpha) even with ProRes 4444. All overlay files should be `prores,yuva444p12le`. Verify: `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt,codec_name -of csv=p=0 <file>.mov`

> **10le vs 12le:** `--pixel-format=yuva444p10le` is Remotion's render flag (input hint). The resulting ProRes 4444 file will probe as `yuva444p12le` — this is correct. Always verify the OUTPUT file shows `yuva444p12le`.

### Post-Render Pixel Format Check (MANDATORY)

After every Remotion render, verify pixel format before using the asset:

```bash
ssh root@100.117.234.17 "docker exec finmentum-post ffprobe -v error -select_streams v:0 \
  -show_entries stream=pix_fmt,codec_name -of csv=p=0 /work/<slug>/<name>.mov"
```
Expected: `prores,yuva444p12le`
If wrong: Re-render. Do NOT proceed to post-processing with a non-alpha overlay.

**Available composition IDs:** `FloatingCard`, `ComparisonBars`, `GrowthCurve`, `DualGrowthCurve`, `NumberReveal`, `ChecklistReveal`, `StatGrid`, `TimelineReveal`, `MythVsFact`, `QuoteReveal`, `RankingList`, `PieBreakdown`, `BeforeAfter`, `StockFootageOverlay`, `IntroOverlay`, `OutroOverlay`

> **Dynamic composition IDs:** The `generate-card.py` system creates additional composition IDs at runtime (e.g., `PaycheckBreakdownCard`, `TaxBracketCard`, `TestGeneratedCard`). These are registered in `src/generated/_register.ts` and `src/generated/manifest.ts` on the container. After generation, they're renderable like any built-in composition. The list above covers only the static/pre-built compositions — generated IDs are determined by the card concept and won't appear here.

### Preview Frame Standards

When posting overlay previews to Discord for user approval, always use these timestamps:

**Intro overlay:**
- Hook text frame: `-ss 0.1` (shows the hook title flash before it fades)
- Banner frame: `-ss 3.0` (shows name/credentials banner fully animated in)
- Post both frames, not just one

**Outro overlay:**
- `-ss 6.0` (CTA and banner fully animated in)

**Floating cards:**
- `-ss 2.0` (card fully animated in, counter counting)

FFmpeg command pattern (composite on white bg for readability):
```bash
ssh root@100.117.234.17 "docker exec finmentum-post ffmpeg -y -ss <TIME> -i /work/<slug>/<file>.mov \
  -frames:v 1 -vf 'colorkey=0x000000:0.01:0.0,pad=1080:1920:0:0:white,scale=540:960' \
  /tmp/<name>-check.jpg 2>/dev/null && docker cp finmentum-post:/tmp/<name>-check.jpg /tmp/<name>-check.jpg"
scp root@100.117.234.17:/tmp/<name>-check.jpg /tmp/<name>-check.jpg
```

### FloatingCard Card Types

| `cardType` | Description | Key props |
|-----------|-------------|-----------|
| `stat` | Hero stat with sparkline — counts up | `statValue`, `statValueNumeric`, `statChange`, `statSubtext`, `statPositive` |
| `stat` (static) | Static text display — add `staticMode: true` to suppress sparkline, counter, change badge. Use for percentages, text values. | `statValue`, `staticMode: true` |
| `comparison` | Two-column before→after with counter animation | `leftLabel`, `leftValueNumeric`, `rightLabel`, `rightValueNumeric`, `comparisonSubtext` |
| `list` | Ranked items list (up to 5), stagger slide-in | `listTitle`, `listItems: [{rank: number, label: string, value: string}]` — objects ONLY, never plain strings |
| `chart` | Animated line chart | `chartTitle`, `chartTicker`, `chartCurrentValue`, `chartDataPoints`, `chartLabels` |
| `benefits` | 3-row table: bold left value + right descriptor, stagger slide-in | `benefitsRows: [{value, valueSubtext?, description}]` |
| `freeform` | Arbitrary text/data — hero value, title, subtext, optional label+value rows. Static (no counter). | `freeformTitle`, `freeformValue`, `freeformSubtext`, `freeformItems: [{label, value}]` |
| `dualColumn` | Two-column side-by-side bracket/comparison table. Left column animates in from left, right from right (staggered). Up to 7 rows. Ideal for tax brackets (single vs MFJ), two-scenario tables. | `dualColumnTitle`, `dualColumnLeftHeader`, `dualColumnRightHeader`, `dualColumnLabels: string[]`, `dualColumnLeft: string[]`, `dualColumnRight: string[]` |

**FloatingCard prop rules (non-negotiable):**
- All content props must be explicitly passed — no prop has a useful default (all content defaults are `""`, `0`, or `[]`)
- `comparison` cardType: always pass `leftValueNumeric` and `rightValueNumeric` as actual **integers** (e.g. `50000`, `2400000`) — NOT display strings like `"$50K"`. The counter animation reads these; defaults to 0 if omitted, counter will not animate
- Empty strings render as `"—"` for values (stat hero number, comparison columns), hidden for labels/subtexts
- `chartDataPoints` empty → shows "No data" message; always pass your data points array
- `durationInFrames`, `cardY`, `cardType` always required
- **Always pass `cardType` in overlay `remotion.props`** — the container uses it to look up per-type height defaults for caption overlap detection. Without it, caption repositioning may use wrong height (especially `accumulator` = 700px)

**Asset cache:** The container caches uploaded asset IDs at `/work/asset-cache.json`. Re-submitting the same render won't re-upload — it returns the cached `asset_id`.

**Chrome Headless Shell (v4+):** The container uses `npx remotion browser ensure` to install Remotion's own Chrome Headless Shell.
No more `chromium-browser` apt package or PUPPETEER_EXECUTABLE_PATH env vars. Remotion auto-discovers its headless shell.

### Updating Remotion Templates

Remotion source lives at `/mnt/user/appdata/finmentum-post/work/remotion-banner/` on Unraid (persistent appdata volume, survives container rebuilds). The container bind-mounts `/mnt/user/appdata/finmentum-post/work` → `/work`, so the project is always available at `/work/remotion-banner/`.

To push updated templates from the gateway:

```bash
# From gateway:
cd /home/jjagpal/.openclaw/workspace-finmentum-studio/remotion-banner
tar czfh /tmp/remotion-update.tar.gz src/
scp /tmp/remotion-update.tar.gz root@100.117.234.17:/tmp/
ssh root@100.117.234.17 "tar xzf /tmp/remotion-update.tar.gz -C /mnt/user/appdata/finmentum-post/work/remotion-banner/ && \
  docker exec finmentum-post sh -c 'ls /work/remotion-banner/src/ | wc -l'"
```

No container restart needed — the bind mount is live.

**Bind mount verification (v4+):** The entrypoint script verifies that /assets, /work, and /output are real bind mounts
(not ephemeral container filesystem) using a sentinel-file write/read/delete test. If verification fails,
the container exits with a clear error message -- it will not accept HTTP requests with missing storage.

#### process.py / api.py Changes

The entrypoint runs uvicorn with `--reload --reload-dir /app`, so changes pushed via `docker cp` to `/app/process.py` or `/app/api.py` take effect automatically within a few seconds. If reload fails or behavior seems stale, restart the container:

```bash
ssh root@100.117.234.17 "docker restart finmentum-post && sleep 8 && curl -s http://localhost:8082/health"
```

If `package.json` changes (new dependencies), run:

```bash
ssh root@100.117.234.17 "docker exec finmentum-post sh -c 'cd /work/remotion-banner && npm install'"
```

## FFmpeg Compositing Rules

### colorkey filter — ONE input only

```bash
# WRONG — fails with "More input link labels specified than it has inputs"
[0:v][1:v]colorkey=0x000000:0.01:0.0[v]

# CORRECT — apply colorkey to overlay stream, pipe result into overlay filter
[1:v]colorkey=0x000000:0.01:0.0,setpts=PTS+5.20/TB[keyed];
[0:v][keyed]overlay=0:0:eof_action=pass[vout]
```

Threshold: **`0.01` only** — higher values remove dark teal/colored elements.

### Overlay Timing — setpts, NOT enable='between'

```bash
# WRONG — composites frame 0 (fully transparent) at the wrong point
[1:v]overlay=enable='between(t,7,12)':format=auto

# CORRECT — shift the overlay stream to its correct timeline position
[1:v]setpts=PTS+7/TB[ov];
[0:v][ov]overlay=format=auto:eof_action=pass[vout]
```

### Trimmed Floating Card with Fade In/Out

```
[N:v]trim=duration=D,setpts=PTS-STARTPTS,format=yuva420p,\
     fade=t=in:st=0:d=0.5:alpha=1,\
     fade=t=out:st=D-0.5:d=0.5:alpha=1,\
     setpts=PTS+START_TIME/TB[card];
[prev][card]overlay=0:0:eof_action=pass[vout]
```

- `setpts=PTS-STARTPTS` after `trim` — **required**: resets timestamps to 0 or overlay timing breaks
- `format=yuva420p` — preserves alpha channel through the fade filters
- `alpha=1` on fade — only alpha fades (not luma), prevents washed-out look
- `START_TIME` = seconds into the output where the card should appear

### Audio Mixing

```bash
# Normalize both streams before amix — voice is often 48kHz, music 44.1kHz
[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];
[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,
     volume=0.04,
     afade=t=out:st=FADE_START:d=2[a1];
[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]
```

Rules:
- **Intermediate composites:** `-c:a copy` (never re-encode until final mix)
- **`aresample` + `aformat` on both streams** before `amix` — skipping this causes pops/choppiness
- **`dropout_transition=0`** on `amix` — prevents clicks when a stream ends early
- **`-b:a 192k`** on final encode
- **Measure `FADE_START`** from the actual source file going into the mix step:
  ```bash
  FADE_START=$(echo "$(ffprobe -v error -show_entries format=duration -of csv=p=0 step1.mp4) - 2" | bc)
  ```

## Background Music

Default volume: **4% (`0.04`)** with 2s fade-out. Downloaded MP3 path goes into the project JSON `music_path` field.

### Music Selection Flow

When presenting music options to the user:
1. Download all candidate tracks to `/tmp/<slug>-music/track1.mp3`, `track2.mp3`, etc.
2. Post each file to Discord with track name + artist so the user can listen.
3. Wait for the user to pick one.
4. **After selection: immediately delete all non-selected sample files** (`rm /tmp/<slug>-music/track*.mp3` except the chosen one). Move the chosen file to `working/<slug>/music.mp3`.
5. Note the selected track name + artist in the project JSON for attribution.

## TTS Preview (Step 8.5 — Pronunciation Check Only)

Before submitting the payload, generate a TTS audio preview to catch pronunciation issues early. This is a **verification step only** — HeyGen does the actual voice rendering during the full render. Do not set any `sceneN_voice` variables in the payload.

### TTS Pre-Processing (optional — apply before building the curl payload for accurate pronunciation preview)

**⚠️ `POST /v1/audio/text_to_speech` ignores `brand_voice_id` — the brand glossary is NOT applied automatically by the TTS endpoint.** To hear accurate pronunciation in the TTS preview, apply the substitutions from the table below to the `text` field before sending the request. Skip this if pronunciation verification isn't needed for the current script.

Apply substitutions in this order (longer/more-specific patterns first to avoid partial replacements):

| Written | Replace with |
|---------|-------------|
| `Roth IRA` | `Roth I-R-A` |
| `401(k)` | `four-oh-one-k` |
| `CalABLE` | `Cal-ABLE` |
| `UGMA` | `U-G-M-A` |
| `SSI` | `S-S-I` |
| `IRA` | `I-R-A` |
| `ETF` | `E-T-F` |
| `HSA` | `H-S-A` |
| `FSA` | `F-S-A` |
| `Ramy` | `Rami` |
| Numbers as digits (e.g. `$19K`) | Spell out (e.g. `nineteen thousand`) |
| Em dashes (`—`) | Replace with `,` or `.` |

> **Before/After example:**
> - Before: `"Put $5K in a Roth IRA or 401(k) — your future self will thank you."`
> - After: `"Put five thousand in a Roth I-R-A or four-oh-one-k, your future self will thank you."`

> **Note:** `Finmentum` and `DM` need no changes — they're already pronounced naturally.

### Generate TTS via n8n

```bash
curl -s http://100.117.234.17:5678/webhook/heygen-tts-preview \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "text": "<script with ALL pronunciation substitutions pre-applied — see TTS Pre-Processing table above>",
    "voice_id": "749758e687a94ec6bd68374824938237",
    "speed": "1.0",
    "scene": "scene1"
  }'
```

n8n downloads the audio and posts it to #finmentum-content-creator automatically.

**Wait for explicit approval before proceeding to Step 9.**

If pronunciation issues are found: update the script text and/or the brand glossary, regenerate TTS, repeat until approved.

### Rules

- TTS preview is for **pronunciation verification only** — never used as the voice source in the payload
- **Never set `sceneN_voice`** variables in the payload — HeyGen renders the voice from the script text
- **Optionally apply the TTS Pre-Processing substitution table** (above) to the script text before calling TTS — recommended when the script contains acronyms (IRA, ETF, SSI, etc.) or financial terms that may be mispronounced
- Note the `duration` returned — flag if it exceeds 50s (script needs trimming)
- **⚠️ TTS preview does NOT apply the brand glossary automatically.** `brand_voice_id` is NOT passed to the TTS endpoint, so agents must apply the pronunciation map manually before sending the request (see TTS Pre-Processing above). The actual HeyGen render applies glossary automatically via `brand_voice_id` in the template payload.
- **TTS preview does NOT match Ramy's actual WPS.** The TTS voice speaks slower than Ramy does in HeyGen renders. A TTS duration of 55-60s typically corresponds to a ~43-48s HeyGen render. Do not flag duration overages from TTS unless the script is clearly way over (>65s TTS = likely over 50s in HeyGen). Trust the word count (138-173 words = 40-50s) over TTS duration.

## Dry Run Mode

When `$ARGUMENTS` contains `--dry-run`:
- Complete all steps through Review (Step 8).
- Show the complete payload JSON (pretty-printed) and summary table.
- Do NOT upload assets or submit to HeyGen.
- Save project JSON and payload for review.

## Error Handling

| Error | Action |
|-------|--------|
| Script JSON parse error | Report error field to user |
| Remotion render fails | Report error, offer different template or skip scene |
| Pexels no results | Suggest alternative keywords or switch to Option A |
| HeyGen 400 | Payload structure issue — show payload for debugging |
| HeyGen 401 | Invalid/missing `HEYGEN_API_KEY` — check `.env` |
| HeyGen timeout | Poll exits after 600s — suggest manual re-check or retry |
