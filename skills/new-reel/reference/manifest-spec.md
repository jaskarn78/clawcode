# Reel Manifest Specification

The manifest is the **single source of truth** for every reel. It captures everything needed to:

- Re-run post-processing (FFmpeg composite) without touching HeyGen
- Re-run the full pipeline from HeyGen render through post-processing
- Reproduce any floating card from scratch (re-render in Remotion)
- Reproduce the intro/outro from scratch (re-render in Remotion)
- Re-download music if the file is lost
- Audit exactly what was used 3 months from now

---

## Schema

```json
{
  "slug": "string",
  "title": "string",
  "status": "draft | rendered | post_processed | completed",
  "created_at": "ISO date (YYYY-MM-DD)",
  "updated_at": "ISO datetime (YYYY-MM-DDTHH:MM:SSZ)",

  "script": "string — full script as spoken (with pronunciation fixes applied)",
  "script_raw": "string — original script before pronunciation fixes",
  "hook_text": "string — opening hook line",
  "word_count": "number",
  "estimated_duration_s": "number",

  "heygen": {
    "template_id": "string",
    "video_id": "string | null",
    "rendered_at": "ISO datetime | null",
    "test": "boolean",
    "brand_voice_id": "string",
    "caption_url": "string | null",
    "video_url": "string | null",
    "video_url_expiry": "ISO datetime | null",
    "duration_s": "number | null"
  },

  "avatar": {
    "avatar_id": "string",
    "avatar_name": "string",
    "type": "talking_photo | instant_avatar",
    "use_avatar_iv_model": "boolean"
  },

  "voice": {
    "voice_id": "string | null",
    "brand_voice_id": "string",
    "speed": "number (default 1.0)"
  },

  "intro": {
    "file": "string — container path",
    "hook_title": "string",
    "person_name": "string",
    "person_title": "string",
    "duration_frames": "number",
    "fps": "number (default 25)",
    "duration_s": "number",
    "exit_by": "number — seconds (max 4)",
    "render_props": "object — full Remotion props"
  },

  "outro": {
    "file": "string — container path",
    "cta_line1": "string",
    "cta_line2": "string",
    "person_name": "string",
    "person_title": "string",
    "duration_frames": "number",
    "fps": "number (default 25)",
    "duration_s": "number",
    "offset_from_end": "number — seconds from video end",
    "render_props": "object — full Remotion props"
  },

  "cards": [
    {
      "name": "string — e.g. 'stat-card'",
      "file": "string — container path",
      "composition_id": "string — e.g. 'FloatingCard'",
      "card_type": "stat | comparison | list | benefits | chart | qualifier | accumulator",
      "duration_frames": "number",
      "fps": "number (default 25)",
      "duration_s": "number",
      "card_y": "number (always 1100)",
      "trigger_phrase": "string — exact phrase from caption file",
      "trigger_time_s": "number | null — approximate time in video",
      "fade": "boolean",
      "render_props": "object — COMPLETE Remotion props",
      "md5": "string | null — checksum to detect duplicates"
    }
  ],

  "music": {
    "track_name": "string",
    "artist": "string",
    "jamendo_track_id": "string | null",
    "jamendo_download_url": "string | null",
    "jamendo_share_url": "string | null",
    "license": "string — e.g. 'CC-BY 3.0'",
    "file": "string — container path",
    "volume": "number (default 0.04)",
    "fade_out_s": "number (default 2.0)"
  },

  "post_processing": {
    "last_run_at": "ISO datetime | null",
    "slug_used": "string | null — n8n trigger slug if different",
    "overlay_order": ["string"] — ordered list of overlay names,
    "colorkey_threshold": "string (always '0.01:0.0')"
  },

  "output": {
    "nextcloud_incomplete": "string — WebDAV path",
    "nextcloud_completed": "string — WebDAV path",
    "filename": "string — e.g. '<slug>-FINAL.mp4' (required by process.py)",
    "share_url": "string | null — public Nextcloud share URL",
    "discord_preview_message_id": "string | null"
  },

  "db": {
    "published_videos_id": "number | null",
    "pushed_at": "ISO datetime | null"
  }
}
```

---

## Field Reference

### Root Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | **Yes** | Unique kebab-case identifier (e.g. `calable-reel`) |
| `title` | string | **Yes** | Human-readable display title |
| `status` | enum | **Yes** | Pipeline state: `draft`, `rendered`, `post_processed`, `completed` |
| `created_at` | ISO date | **Yes** | Date manifest was created |
| `updated_at` | ISO datetime | **Yes** | Last modification timestamp |

### Script Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `script` | string | **Yes** | Full script with pronunciation fixes applied (what HeyGen receives) |
| `script_raw` | string | No | Original script before pronunciation fixes (for reference) |
| `hook_text` | string | **Yes** | Opening hook line for intro card |
| `word_count` | number | **Yes** | Total word count |
| `estimated_duration_s` | number | **Yes** | Estimated duration (words / 3.46) |

### HeyGen Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `heygen.template_id` | string | **Yes** | HeyGen template ID used |
| `heygen.video_id` | string | After render | HeyGen video ID (set after successful submission) |
| `heygen.rendered_at` | ISO datetime | After render | When HeyGen render completed |
| `heygen.test` | boolean | **Yes** | Whether render used test mode |
| `heygen.brand_voice_id` | string | **Yes** | Brand voice ID for pronunciation glossary |
| `heygen.caption_url` | string | After render | .ass subtitle file URL |
| `heygen.video_url` | string | After render | Clean video URL (no captions) |
| `heygen.video_url_expiry` | ISO datetime | After render | When HeyGen URL expires (~24h from render) |
| `heygen.duration_s` | number | After render | Actual rendered duration in seconds |

> **WARNING:** HeyGen `video_url` expires within ~24 hours. Before re-triggering post-processing, ALWAYS re-fetch via `heygen-poll` using the stored `video_id`. Update the manifest with fresh URLs.

### Avatar Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `avatar.avatar_id` | string | **Yes** | HeyGen avatar ID |
| `avatar.avatar_name` | string | **Yes** | Human-readable avatar name |
| `avatar.type` | enum | **Yes** | `talking_photo` or `instant_avatar` |
| `avatar.use_avatar_iv_model` | boolean | **Yes** | Always `true` for better gestures/lip sync |

### Voice Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `voice.voice_id` | string | No | Direct voice ID (if not using brand voice) |
| `voice.brand_voice_id` | string | **Yes** | Brand voice ID (handles pronunciation glossary) |
| `voice.speed` | number | No | Speech speed multiplier (default 1.0) |

### Intro Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `intro.file` | string | **Yes** | Container path: `/assets/<slug>/intro.mov` |
| `intro.hook_title` | string | **Yes** | Text shown in the hook flash |
| `intro.person_name` | string | **Yes** | Name displayed (e.g. "Ramy Hindiyeh") |
| `intro.person_title` | string | **Yes** | Title displayed (e.g. "Financial Advisor") |
| `intro.duration_frames` | number | **Yes** | Render duration in frames |
| `intro.fps` | number | **Yes** | Frames per second (always 25) |
| `intro.duration_s` | number | **Yes** | Duration in seconds (frames / fps) |
| `intro.exit_by` | number | **Yes** | Seconds before intro fades out (defaults to 4s if omitted; pass actual intro duration to override cap) |
| `intro.render_props` | object | **Yes** | Complete Remotion props object for re-rendering |

### Outro Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `outro.file` | string | **Yes** | Container path: `/assets/<slug>/outro-final.mov` |
| `outro.cta_line1` | string | **Yes** | First CTA line |
| `outro.cta_line2` | string | **Yes** | Second CTA line |
| `outro.person_name` | string | **Yes** | Name displayed |
| `outro.person_title` | string | **Yes** | Title displayed |
| `outro.duration_frames` | number | **Yes** | Render duration in frames |
| `outro.fps` | number | **Yes** | Frames per second (always 25) |
| `outro.duration_s` | number | **Yes** | Duration in seconds |
| `outro.offset_from_end` | number | **Yes** | Seconds from end of video when outro starts |
| `outro.render_props` | object | **Yes** | Complete Remotion props object for re-rendering |

### Cards Array

Each card object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Identifier (e.g. `stat-card`, `diag-card`) |
| `file` | string | **Yes** | Container path: `/assets/<slug>/<name>.mov` |
| `composition_id` | string | **Yes** | Remotion composition ID (e.g. `FloatingCard`) |
| `card_type` | enum | **Yes** | `stat`, `comparison`, `list`, `benefits`, `chart`, `qualifier`, `accumulator` |
| `duration_frames` | number | **Yes** | Render duration in frames |
| `fps` | number | **Yes** | Frames per second (always 25) |
| `duration_s` | number | **Yes** | Duration in seconds |
| `card_y` | number | **Yes** | Vertical position (always 1100) |
| `trigger_phrase` | string | **Yes** | Exact phrase from script that triggers appearance |
| `trigger_time_s` | number | No | Approximate time in video when triggered |
| `fade` | boolean | **Yes** | Whether to apply fade in/out |
| `render_props` | object | **Yes** | **COMPLETE** Remotion props — everything needed to re-render |
| `md5` | string | No | Checksum of rendered .mov file |

### Music Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `music.track_name` | string | **Yes** | Track title |
| `music.artist` | string | **Yes** | Artist name |
| `music.jamendo_track_id` | string | No | Jamendo track ID (for re-download) |
| `music.jamendo_download_url` | string | No | Direct MP3 download URL |
| `music.jamendo_share_url` | string | No | Public Jamendo share URL |
| `music.license` | string | **Yes** | License (e.g. `CC-BY 3.0`, `CC-BY-NC 4.0`) |
| `music.file` | string | **Yes** | Container path: `/assets/<slug>/music.mp3` |
| `music.volume` | number | **Yes** | Mix volume (typically 0.04) |
| `music.fade_out_s` | number | **Yes** | Fade out duration at end (typically 2.0) |

### Post-Processing Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `post_processing.last_run_at` | ISO datetime | No | When post-processing last ran |
| `post_processing.slug_used` | string | No | n8n trigger slug if different from main slug |
| `post_processing.overlay_order` | array | **Yes** | Ordered list of overlay names as submitted |
| `post_processing.colorkey_threshold` | string | **Yes** | Always `0.01:0.0` |

### Output Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `output.nextcloud_incomplete` | string | **Yes** | WebDAV path for raw HeyGen render |
| `output.nextcloud_completed` | string | **Yes** | WebDAV path for final post-processed file |
| `output.filename` | string | **Yes** | Output filename e.g. `<slug>-FINAL.mp4` — required by process.py |
| `output.share_url` | string | No | Public Nextcloud share URL (set after upload) |
| `output.discord_preview_message_id` | string | No | Discord message ID of preview post |

### Database Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `db.published_videos_id` | number | No | ID in published_videos table (set after DB push) |
| `db.pushed_at` | ISO datetime | No | When pushed to database |

---

## Status Lifecycle

| Status | Set when | Required fields at this stage |
|--------|----------|-------------------------------|
| `draft` | Manifest created at scene lock-in (Step 4) | `slug`, `title`, `script`, `hook_text`, `heygen.template_id`, `avatar`, `voice`, `intro`, `outro`, `cards` (with `render_props`), `created_at` |
| `rendered` | HeyGen render complete | + `heygen.video_id`, `heygen.video_url`, `heygen.caption_url`, `heygen.duration_s`, `heygen.rendered_at` |
| `post_processed` | Post-processing complete | + `music` (full), `post_processing`, `output.nextcloud_*` |
| `completed` | Share URL created, user approved | + `output.share_url`, `db` (if pushed) |

---

## When to Update the Manifest

| Milestone | Fields to update |
|-----------|------------------|
| Step 4: Scene lock-in | Create manifest with all planning fields: `slug`, `title`, `script*`, `hook_text`, `word_count`, `estimated_duration_s`, `heygen.template_id`, `heygen.brand_voice_id`, `heygen.test`, `avatar`, `voice`, `intro`, `outro`, `cards` (full `render_props`), `status=draft`, `created_at` |
| Step 4.5: Cards rendered | Add `md5` checksum to each card entry |
| Step 7: Music selected | Add `music` (full object including `jamendo_*` fields) |
| Step 9: HeyGen submitted | Add `heygen.video_id`, set `heygen.rendered_at` |
| HeyGen poll complete | Add `heygen.video_url`, `heygen.caption_url`, `heygen.video_url_expiry`, `heygen.duration_s`, set `status=rendered` |
| Post-processing complete | Add `post_processing`, `output.nextcloud_incomplete`, `output.nextcloud_completed`, set `status=post_processed` |
| Share URL created | Add `output.share_url`, set `status=completed` |
| DB push (after user approval) | Add `db.published_videos_id`, `db.pushed_at` |

**Always update `updated_at` on every write.**

---

## Re-Running Post-Processing

If post-processing needs to be re-run (fix, new music, etc.):

1. Load the manifest from `projects/<slug>-manifest.json`
2. **Re-fetch fresh HeyGen URLs** via `heygen-poll` using `heygen.video_id` (URLs expire within ~24h)
3. Update `heygen.video_url`, `heygen.caption_url`, `heygen.video_url_expiry` in the manifest
4. Build the `post-process-trigger` payload from manifest fields:
   - `overlays` array from `cards` + `intro` + `outro`
   - `music` from `music` object
   - `output` from `output` object
5. Trigger post-processing
6. Update `post_processing.last_run_at`

---

## Re-Rendering a Card

If a card needs to be re-rendered:

1. Load the manifest
2. Find the card in the `cards` array
3. Use the `render_props` object exactly as-is to submit a Remotion render job
4. Update `card.file` path and `card.md5` after render completes
5. Re-run post-processing with updated card

---

## Save Location

```
workspace-finmentum-studio/finmentum/projects/<slug>-manifest.json
```

The manifest is also stored in the `manifest` column of `published_videos` after DB push.
