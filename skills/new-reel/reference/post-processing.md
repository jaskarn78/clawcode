# Post-Processing Pipeline Reference

Full guide for taking a HeyGen render to a final, post-processed reel ready for Instagram.

---

## How to Trigger Post-Processing

**Always use n8n.** Never call the container API directly for post-processing.

### Preferred: Manifest-Based Trigger (Minimal Payload)

When a manifest has already been saved to the container (via `POST /manifests/<video_id>`), the container auto-loads overlays, music, and output config from it. Just pass identifiers and HeyGen URLs:

```bash
curl -s http://100.117.234.17:5678/webhook/post-process-trigger \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "video_id": "<video_id>",
    "slug": "<slug>",
    "heygen_video_url": "<video_url from heygen-poll>",
    "heygen_caption_url": "<caption_url from heygen-poll>"
  }'
```

**Requirements:**
- Manifest must be saved to the container BEFORE triggering (`POST /manifests/<video_id>`)
- The manifest contains overlays, music, and output paths
- Container reads `/work/manifests/{video_id}.json` and auto-populates missing fields
- Overlays do NOT need to be in the POST body when a manifest exists

This is the pattern used by the HeyGen webhook receiver and the poll fallback workflow.

### Alternative: Full Inline Payload

If no manifest exists (or you want to override it), pass everything explicitly:

```bash
curl -s http://100.117.234.17:5678/webhook/post-process-trigger \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "slug": "<slug>",
    "heygen_video_url": "<video_url from heygen-poll>",
    "heygen_caption_url": "<caption_url from heygen-poll>",
    "overlays": [
      {"name":"intro","file":"/assets/<slug>/intro.mov","type":"intro","exit_by":4},
      {"name":"stat-card","file":"/assets/<slug>/stat-card.mov","type":"card",
       "trigger_phrase":"<exact spoken words>","duration":7,"fade":true},
      {"name":"comp-card","file":"/assets/<slug>/comp-card.mov","type":"card",
       "trigger_phrase":"<exact spoken words>","duration":7,"fade":true},
      {"name":"outro","file":"/assets/<slug>/outro-final.mov","type":"outro","offset_from_end":5}
    ],
    "music": {"file_path": "/assets/<slug>/music.mp3", "volume": 0.04},
    "output": {
      "nextcloud_incomplete": "Finmentum reels/Incomplete/<slug>.mp4",
      "nextcloud_completed": "Finmentum reels/Completed/<slug>-FINAL.mp4",
      "filename": "<slug>-FINAL.mp4"
    }
  }'
```

## Container Pre-Flight Validation (v4+)

The container automatically validates before starting the FFmpeg pipeline. If validation fails, it returns a structured error immediately -- no partial FFmpeg runs.

**Checks performed:**
| Check | What It Validates | Error If Failed |
|-------|-------------------|-----------------|
| `overlays_present` | overlays array is non-empty | "Overlays list is empty or missing" |
| `overlay_file_exists` | each overlay .mov file exists at specified path | "Overlay file not found: /assets/..." |
| `overlay_pixel_format` | each overlay has yuva444p pixel format | "Wrong pixel format: expected yuva444p, got ..." |
| `music_file_exists` | music.mp3 exists if music config is present | "Music file not found: /assets/..." |
| `filter_compliance` | format=yuva444p before colorkey in FFmpeg filters | "Filter chain violation: ..." |
| `colorkey_threshold` | colorkey threshold is exactly 0.01 | "Colorkey threshold must be 0.01" |

**Error response format:**
```json
{
  "status": "error",
  "error_type": "preflight_error",
  "detail": "Pre-flight validation failed",
  "errors": [
    {"check": "overlays_present", "detail": "Overlays list is empty or missing"}
  ],
  "retryable": false
}
```

**Field aliasing:** Both camelCase and snake_case field names are accepted. Examples:
- `heygen_video_url` or `video_url`
- `heygen_caption_url` or `caption_url`
- `composition_id` or `template`

---

**Trigger phrase rules:**
- Must match exact words Ramy speaks (check `.ass` caption file)
- Wrong phrases → card auto-sequences after previous card (safe fallback)
- Fuzzy word matching is used as a second-pass fallback

**Asset paths:** `/assets/<slug>/` in container = `/mnt/user/appdata/finmentum-post/assets/<slug>/` on Unraid.

---

## FFmpeg Pipeline (Reference — Runs Inside Container)

---

## Overview

Post-processing happens in **two FFmpeg passes**:

| Pass | What Happens | Audio Handling |
|------|-------------|----------------|
| **Step 1** | Caption burn-in + intro banner composite | `-c:a copy` (no re-encode) |
| **Step 2** | All cards + outro overlay + music mix | Final encode: `-c:a aac -b:a 192k` |

**Why two passes instead of one?**  
Captions must be burned before overlays are composited (caption sub-filter can't run alongside complex filter chains). The two-pass approach keeps Step 1 audio pristine (copy passthrough) so Step 2 only encodes audio once.

---

## Pre-Conditions (Before Running)

1. HeyGen render complete. Artifacts saved:
   - `heygen-render.mp4` — clean video (from `video_url`, no captions)
   - `captions.ass` — word-level subtitle file (from `caption_url`)

2. All Remotion ProRes 4444 overlays rendered:
   - `intro-alpha.mov` (or `intro-opt3.mov` etc.)
   - `outro-final.mov`
   - Per-scene cards: `stat-card-alpha.mov`, `comp-card-alpha.mov`, etc.

3. Background music downloaded: `music.mp3`

4. Timing anchors extracted from the `.ass` caption file (use timestamps for card appearances)

---

## Step 1: Captions + Intro Banner

**Output:** `step1_captioned_intro.mp4`

```bash
# 1a. Restyle .ass captions
python3 restyle_captions.py captions.ass captions_styled.ass

# 1b. Burn captions into clean video
ffmpeg -i heygen-render.mp4 \
  -vf "ass=captions_styled.ass" \
  -c:v libx264 -crf 18 \
  -c:a copy \
  step1_captioned.mp4

# 1c. Composite intro banner (capped at 4s)
# Intro is trimmed to 4s max — do NOT use a 7s intro, it runs over dialogue
ffmpeg -i step1_captioned.mp4 -i intro-alpha.mov \
  -filter_complex "
    [1:v]colorkey=0x000000:0.01:0.0,
         trim=duration=4,setpts=PTS-STARTPTS,
         format=yuva420p,
         fade=t=in:st=0:d=0.3:alpha=1,
         fade=t=out:st=3.5:d=0.5:alpha=1,
         setpts=PTS+0/TB[intro];
    [0:v][intro]overlay=0:0:eof_action=pass[vout]
  " \
  -map "[vout]" -map 0:a \
  -c:v libx264 -crf 18 \
  -c:a copy \
  step1_captioned_intro.mp4
```

**IMPORTANT:** Intro banner duration is **capped at 4 seconds**. Do not use 7s — it bleeds into the first spoken lines.

---

## Step 2: All Cards + Outro + Music (Single Pass)

**Input:** `step1_captioned_intro.mp4`  
**Output:** `final.mp4`

All remaining overlays (data cards, outro) and the music mix happen in a **single FFmpeg pass** to avoid multiple AAC encode cycles.

```bash
# Measure source duration for music fade
VID_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 step1_captioned_intro.mp4)
FADE_START=$(echo "$VID_DUR - 2" | bc)

ffmpeg \
  -i step1_captioned_intro.mp4 \   # [0] base
  -i stat-card-alpha.mov \          # [1] card 1
  -i comp-card-alpha.mov \          # [2] card 2
  -i outro-final.mov \              # [3] outro
  -i music.mp3 \                    # [4] music
  -filter_complex "
    [1:v]colorkey=0x000000:0.01:0.0,
         trim=duration=10,setpts=PTS-STARTPTS,
         format=yuva420p,
         fade=t=in:st=0:d=0.5:alpha=1,
         fade=t=out:st=9.5:d=0.5:alpha=1,
         setpts=PTS+5.17/TB[c1];
    [2:v]colorkey=0x000000:0.01:0.0,
         trim=duration=10,setpts=PTS-STARTPTS,
         format=yuva420p,
         fade=t=in:st=0:d=0.5:alpha=1,
         fade=t=out:st=9.5:d=0.5:alpha=1,
         setpts=PTS+16.67/TB[c2];
    [3:v]colorkey=0x000000:0.01:0.0,
         setpts=PTS+OUTRO_START/TB[outro];
    [0:v][c1]overlay=0:0:eof_action=pass[v1];
    [v1][c2]overlay=0:0:eof_action=pass[v2];
    [v2][outro]overlay=0:0:eof_action=pass[vout];
    [0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];
    [4:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,
         volume=0.04,
         afade=t=out:st=${FADE_START}:d=2[a1];
    [a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]
  " \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -crf 18 -preset slow \
  -c:a aac -b:a 192k \
  final.mp4
```

Adjust `5.17`, `16.67`, and `OUTRO_START` to the actual card timestamps from caption timing.

---

## Audio Mixing Rules (Non-Negotiable)

| Rule | Why |
|------|-----|
| `-c:a copy` on ALL intermediate composites | Prevents quality-degrading encode cycles |
| `aresample=44100` + `aformat=fltp:stereo` on both streams before `amix` | Voice is 48kHz, music 44.1kHz — mixing without normalization causes pops |
| `dropout_transition=0` on `amix` | Prevents clicks when one stream ends before the other |
| `-b:a 192k` on final encode | Explicit bitrate for clean output |
| Measure `FADE_START` from `step1_captioned_intro.mp4` | Always from the actual file going into the mix, not an earlier stage |

---

## Nextcloud Auth (WebDAV)

> **WARNING:** The "NextCloud" item in 1Password stores **database credentials**, not WebDAV.

The password is stored in the finmentum-post container env: `NEXTCLOUD_PASSWORD`. Use it directly — no 1Password needed at runtime.

```bash
NC_PASS=$(ssh root@100.117.234.17 "docker exec finmentum-post env" | grep NEXTCLOUD_PASSWORD | cut -d= -f2)

# Upload to Incomplete (raw render)
curl -u "jjagpal:${NC_PASS}" -T heygen-render.mp4 \
  "https://storage.jjagpal.me/remote.php/dav/files/jjagpal/Finmentum reels/Incomplete/<slug>.mp4"

# Upload to Completed (final)
curl -u "jjagpal:${NC_PASS}" -T final.mp4 \
  "https://storage.jjagpal.me/remote.php/dav/files/jjagpal/Finmentum reels/Completed/<slug>-FINAL.mp4"
```

## Nextcloud Public Share URL

After uploading the final file, create a public share link so Jas can view/download from any device:

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

echo "Share URL: ${SHARE_URL}"
```

- `shareType=3` = public link (no login required)
- `permissions=1` = read-only
- Returns a URL like `https://storage.jjagpal.me/s/ABC123XYZ`
- **Always post this URL to Discord** alongside the compressed preview so Jas can download the full quality version

**Post to Discord:**
```
✅ <slug> is done!
📥 Full quality: https://storage.jjagpal.me/s/ABC123XYZ
```

---

## File Lifecycle

```
1. HeyGen render complete
   → Download to working/<slug>/heygen-render.mp4
   → Upload to Nextcloud Incomplete/<slug>.mp4

2. Step 1: Captions + intro banner
   → step1_captioned_intro.mp4
   (audio: -c:a copy throughout)

3. Step 2: Cards + outro + music
   → final.mp4
   (audio: single aac encode at 192k)

4. Upload to Nextcloud Completed/<slug>-FINAL.mp4

5. Compress for Discord (if > 25MB)
   → final_discord.mp4
   Post to #finmentum-content-creator
```

---

## Common Gotchas

### colorkey takes ONE input
```bash
# WRONG
[0:v][1:v]colorkey=0x000000:0.01:0.0

# CORRECT — apply to overlay stream, then pipe to overlay
[1:v]colorkey=0x000000:0.01:0.0[keyed];
[0:v][keyed]overlay=0:0:eof_action=pass[vout]
```

### Overlay timing
```bash
# WRONG — composites frame 0 (transparent) at wrong position
[1:v]overlay=enable='between(t,7,12)'

# CORRECT
[1:v]setpts=PTS+7/TB[ov];
[0:v][ov]overlay=format=auto:eof_action=pass[vout]
```

### Intro banner cap
Intro display duration: **4 seconds maximum**. A 7s intro overlaps first spoken lines.

### ASS caption headers
The restyled `.ass` file MUST contain:
```
PlayResX: 1080
PlayResY: 1920
```
Without these, libass defaults to 640x480 → font scaling breaks → text overflows.

---

## Caption Restyling (finmentum brand)

- Font: Montserrat Bold, 28pt
- Text color: white (`&H00FFFFFF`)
- Highlight (current word): `#A1FCCD` (teal)
- Karaoke: `\kf` tags for word-level highlight — currently-spoken word in gold (`#F5D020`), previous words dim white
- PlayResX: 1080, PlayResY: 1920 (required — see above)

See `ffmpeg-recipes.md` §8 for burn-in command.
