# FFmpeg Recipes — Finmentum Post-Processing Cheatsheet

All recipes are battle-tested. Copy-paste safe. Use as building blocks in the assembly pipeline.

---

## 1. Colorkey (Alpha Extraction from Black Background)

> **CRITICAL:** `colorkey` takes **ONE** video input. Apply it to the overlay stream first, then pipe to `overlay`.

```bash
# WRONG — will error "More input link labels specified than it has inputs"
ffmpeg -i base.mp4 -i overlay.mov \
  -filter_complex "[0:v][1:v]colorkey=0x000000:0.01:0.0[v]" ...

# CORRECT
ffmpeg -i base.mp4 -i overlay.mov \
  -filter_complex "
    [1:v]colorkey=0x000000:0.01:0.0,setpts=PTS+5.20/TB[keyed];
    [0:v][keyed]overlay=0:0:eof_action=pass[v]
  " -map "[v]" -map 0:a -c:a copy output.mp4
```

**Threshold `0.01` only** — higher values eat dark teal / colored elements.

---

## 2. Overlay Timing (setpts offset, NOT enable='between')

> **CRITICAL:** Never use `enable='between(t,START,END)'` for overlay timing. It composites frame 0 (transparent) at the wrong point. Use `setpts=PTS+START/TB` instead.

```bash
# WRONG — transparent frame 0 bleeds into wrong position
[1:v]overlay=enable='between(t,7,12)':format=auto

# CORRECT — offset overlay to its intended start time on the timeline
[1:v]setpts=PTS+7/TB[ov];
[0:v][ov]overlay=format=auto:eof_action=pass[vout]
```

---

## 3. Trimmed Floating Card with Fade In/Out

For ProRes 4444 alpha overlays that appear for a limited window with fade in/out:

```
[N:v]trim=duration=D,setpts=PTS-STARTPTS,format=yuva420p,\
     fade=t=in:st=0:d=0.5:alpha=1,\
     fade=t=out:st=D-0.5:d=0.5:alpha=1,\
     setpts=PTS+START_TIME/TB[card];
[prev][card]overlay=0:0:eof_action=pass[vout]
```

**Variable substitutions:**
- `N` = input index (0-based)
- `D` = card display duration in seconds (e.g. `5` for 5 seconds)
- `D-0.5` = fade-out start = `D - 0.5` (e.g. `4.5` for 5s duration)
- `START_TIME` = when card appears on the timeline (e.g. `8.0` for 8 seconds in)

**Why each step:**
- `trim=duration=D` — limit clip to display window only
- `setpts=PTS-STARTPTS` — **required** after trim: resets timestamps to 0 or timing breaks
- `format=yuva420p` — preserve alpha channel through the fade filters
- `alpha=1` on fade — only the alpha channel fades, not luma (prevents washed-out look)
- `setpts=PTS+START_TIME/TB` — place card at correct position on the output timeline

---

## 4. Audio Mixing (amix with Sample Rate Normalization)

**The full correct recipe for mixing voice track + background music:**

```bash
ffmpeg -i voice_with_captions.mp4 -i music.mp3 \
  -filter_complex "
    [0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];
    [1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,
         volume=0.04,
         afade=t=out:st=FADE_START:d=2[a1];
    [a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]
  " \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -crf 18 -preset slow \
  -c:a aac -b:a 192k \
  output_final.mp4
```

**Rules:**
1. `aresample=44100` + `aformat=sample_fmts=fltp:channel_layouts=stereo` on **both** streams before `amix` — voice is often 48kHz, music 44.1kHz; mixing without normalizing causes pops and choppiness
2. `dropout_transition=0` on `amix` — prevents clicks when one stream ends before the other
3. `-b:a 192k` on final encode — explicit bitrate for clean output
4. `FADE_START` = measure from the **actual source file going into the mix step** (`ffprobe -v error -show_entries format=duration -of csv=p=0 source.mp4`), minus 2s for fade

---

## 5. Intermediate Composite Steps — Audio Passthrough

When compositing overlays in intermediate steps (before the final music mix), **always pass audio through without re-encoding**:

```bash
# For intro banner composite (Step A):
ffmpeg -i base.mp4 -i intro_overlay.mov \
  -filter_complex "[1:v]colorkey=...[keyed]; [0:v][keyed]overlay=...[v]" \
  -map "[v]" -map 0:a \
  -c:v libx264 -crf 18 \
  -c:a copy \          # <-- passthrough, no re-encode
  intro_composited.mp4

# Same for outro composite (Step B):
  -c:a copy
```

**Why:** Each AAC encode cycle degrades quality. With 3+ encode/decode cycles (intro composite → outro composite → final music mix), audio becomes noticeably choppy. Use `-c:a copy` on all intermediate steps, encode only once in the final music mix step.

---

## 6. Multi-Overlay Single Pass

When compositing multiple cards + outro in a single FFmpeg pass (Step 2 of post-processing):

```bash
ffmpeg \
  -i intro_composited.mp4 \    # input [0] — base video with captions + intro
  -i card1.mov \               # input [1]
  -i card2.mov \               # input [2]
  -i outro.mov \               # input [3]
  -i music.mp3 \               # input [4]
  -filter_complex "
    [1:v]colorkey=0x000000:0.01:0.0,
         trim=duration=CARD1_DUR,setpts=PTS-STARTPTS,
         format=yuva420p,
         fade=t=in:st=0:d=0.5:alpha=1,
         fade=t=out:st=CARD1_DUR-0.5:d=0.5:alpha=1,
         setpts=PTS+CARD1_START/TB[c1];
    [2:v]colorkey=0x000000:0.01:0.0,
         trim=duration=CARD2_DUR,setpts=PTS-STARTPTS,
         format=yuva420p,
         fade=t=in:st=0:d=0.5:alpha=1,
         fade=t=out:st=CARD2_DUR-0.5:d=0.5:alpha=1,
         setpts=PTS+CARD2_START/TB[c2];
    [3:v]colorkey=0x000000:0.01:0.0,setpts=PTS+OUTRO_START/TB[outro];
    [0:v][c1]overlay=0:0:eof_action=pass[v1];
    [v1][c2]overlay=0:0:eof_action=pass[v2];
    [v2][outro]overlay=0:0:eof_action=pass[vout];
    [0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];
    [4:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,
         volume=0.04,
         afade=t=out:st=FADE_START:d=2[a1];
    [a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]
  " \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -crf 18 -preset slow \
  -c:a aac -b:a 192k \
  final.mp4
```

---

## 7. Probe Duration (for fade calculations)

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 input.mp4
# Returns: 41.856000
# Music fade start = duration - 2.0
```

---

## 8. Caption Burn-In (ASS Subtitles)

```bash
ffmpeg -i clean_video.mp4 \
  -vf "ass=captions.ass" \
  -c:v libx264 -crf 18 \
  -c:a copy \
  captioned.mp4
```

**CRITICAL:** The `.ass` file MUST have these headers in `[Script Info]`:
```
PlayResX: 1080
PlayResY: 1920
```
Without these, libass defaults to 640x480 and font scaling breaks — text overflows the frame.

---

## 9. Compress for Discord (under 25MB)

```bash
# Two-pass to hit target size
TARGET_MB=24
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 input.mp4)
TARGET_KBPS=$(echo "scale=0; $TARGET_MB * 8192 / $DURATION" | bc)
VIDEO_KBPS=$(($TARGET_KBPS - 128))

ffmpeg -i input.mp4 \
  -c:v libx264 -b:v ${VIDEO_KBPS}k -pass 1 -an -f null /dev/null && \
ffmpeg -i input.mp4 \
  -c:v libx264 -b:v ${VIDEO_KBPS}k -pass 2 \
  -c:a aac -b:a 128k \
  output_discord.mp4
```
