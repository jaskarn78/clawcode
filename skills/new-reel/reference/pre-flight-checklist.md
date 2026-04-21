# Pre-Flight Checklist — Post-Processing Trigger

> **Note (v4+):** The finmentum-post container now performs automated pre-flight validation
> before starting FFmpeg. Checks 1 (overlay files exist), 2 (pixel format), and 6 (music file)
> are now caught automatically by the container with structured error responses.
> This manual checklist is still valuable for checks 3-5 and 7 (duplicate md5s, intro/outro text,
> trigger phrases, stale files) which require human judgment.

Run this checklist **before every `post-process-trigger` call**. Every item must pass.

---

## 0. Copy Card Files from /work/ to /assets/ (BEFORE CHECKLIST)

**⚠️ Remotion renders output to `/work/<slug>/`. Post-processing reads from `/assets/<slug>/`. These are DIFFERENT directories. Always copy after each render using `docker exec cp` — SCP to host bind-mount will NOT work.**

```bash
# Create assets dir (idempotent):
ssh root@100.117.234.17 "docker exec finmentum-post mkdir -p /assets/<slug>/"

# Copy each card, intro, outro:
ssh root@100.117.234.17 "docker exec finmentum-post cp /work/<slug>/intro.mov /assets/<slug>/intro.mov"
ssh root@100.117.234.17 "docker exec finmentum-post cp /work/<slug>/outro.mov /assets/<slug>/outro.mov"
ssh root@100.117.234.17 "docker exec finmentum-post cp /work/<slug>/<card1>.mov /assets/<slug>/<card1>.mov"
# ... repeat for all cards

# Verify:
ssh root@100.117.234.17 "docker exec finmentum-post ls -la /assets/<slug>/"
```

---

## 1. Overlay Files Exist

For each entry in the `overlays[]` array, verify the file exists at the specified container path:

```bash
# Run for each overlay file path
ssh root@100.117.234.17 "docker exec finmentum-post test -f <FILE_PATH> && echo OK || echo MISSING"
```

| Overlay | Path | Status |
|---------|------|--------|
| intro | `/assets/<slug>/intro.mov` | [ ] OK |
| card 1 | `/assets/<slug>/<card1>.mov` | [ ] OK |
| card 2 | `/assets/<slug>/<card2>.mov` | [ ] OK |
| outro | `/assets/<slug>/outro-final.mov` | [ ] OK |

**If MISSING:** Render the asset first, then re-check.

---

## 2. Pixel Format Validation (yuva444p12le)

Every overlay `.mov` must have alpha-capable pixel format:

```bash
ssh root@100.117.234.17 "docker exec finmentum-post ffprobe -v error -select_streams v:0 \
  -show_entries stream=pix_fmt -of csv=p=0 <FILE_PATH>"
```

| Overlay | Expected | Actual | Status |
|---------|----------|--------|--------|
| intro | `yuva444p12le` | | [ ] OK |
| card 1 | `yuva444p12le` | | [ ] OK |
| card 2 | `yuva444p12le` | | [ ] OK |
| outro | `yuva444p12le` | | [ ] OK |

**If wrong pixel format:** Re-render with `--image-format=png` and ProRes 4444. Do NOT proceed.

---

## 3. No Duplicate MD5s Among Cards

Duplicate md5s indicate the same file was used for two different cards (copy error):

```bash
ssh root@100.117.234.17 "docker exec finmentum-post md5sum /assets/<slug>/*.mov"
```

- [ ] All card `.mov` files have unique md5 checksums
- [ ] Each md5 matches the value recorded in the manifest `cards[N].md5`

---

## 4. Intro/Outro Text Matches Current Reel

Extract a preview frame from intro and outro to verify correct text:

```bash
# Intro — extract frame at 2s (banner should be visible)
ssh root@100.117.234.17 "docker exec finmentum-post ffmpeg -y -ss 2 \
  -i /assets/<slug>/intro.mov -frames:v 1 /tmp/intro-preview.png 2>/dev/null"
ssh root@100.117.234.17 "docker cp finmentum-post:/tmp/intro-preview.png /tmp/intro-preview.png"
scp root@100.117.234.17:/tmp/intro-preview.png /tmp/intro-preview.png

# Outro — extract frame at 1.5s (CTA should be visible)
ssh root@100.117.234.17 "docker exec finmentum-post ffmpeg -y -ss 1.5 \
  -i /assets/<slug>/outro-final.mov -frames:v 1 /tmp/outro-preview.png 2>/dev/null"
ssh root@100.117.234.17 "docker cp finmentum-post:/tmp/outro-preview.png /tmp/outro-preview.png"
scp root@100.117.234.17:/tmp/outro-preview.png /tmp/outro-preview.png
```

- [ ] Intro hook title matches: `_________________________________`
- [ ] Intro person name/title correct:
  - `personName`: `Ramy Hindiyeh, Ph.D., MBA`
  - `personTitle`: `Principal Investment Advisor at Finmentum`
- [ ] Outro CTA line 1 matches: `_________________________________`
- [ ] Outro CTA line 2 matches: `_________________________________`

**Post preview frames to Discord** for visual verification if any doubt.

---

## 5. Trigger Phrases Verified Against .ass Caption File

Download the `.ass` caption file and verify each card's trigger phrase exists:

```bash
# Download caption file
scp root@100.117.234.17:/mnt/user/appdata/finmentum-post/work/<slug>/heygen-captions.ass /tmp/captions.ass

# Search for each trigger phrase (case-insensitive)
grep -i "<trigger phrase 1>" /tmp/captions.ass
grep -i "<trigger phrase 2>" /tmp/captions.ass
```

| Card | Trigger Phrase | Found in .ass? | Line Start Time |
|------|---------------|----------------|-----------------|
| card 1 | | [ ] Yes | |
| card 2 | | [ ] Yes | |

**If not found:** Check the actual spoken words in the `.ass` file and update the trigger phrase to match.

---

## 6. Music File Exists

```bash
ssh root@100.117.234.17 "docker exec finmentum-post test -f /assets/<slug>/music.mp3 && echo OK || echo MISSING"
```

- [ ] Music file exists at `/assets/<slug>/music.mp3`
- [ ] Music file path in payload matches: `/assets/<slug>/music.mp3`

**If MISSING:** Sync from gateway using docker cp (NOT direct scp to bind-mount):
```bash
scp working/<slug>/music.mp3 root@100.117.234.17:/tmp/music.mp3
ssh root@100.117.234.17 "docker cp /tmp/music.mp3 finmentum-post:/assets/<slug>/music.mp3"
```

---

## 7. Slug Isolation (No Stale Files)

Verify no unexpected files from a previous reel exist in the assets directory:

```bash
ssh root@100.117.234.17 "docker exec finmentum-post ls -la /assets/<slug>/"
```

- [ ] Every `.mov` file listed is referenced in the overlay spec
- [ ] No files from a different reel (check timestamps — should all be from current session)
- [ ] If stale files found: delete them before proceeding

---

## Summary Gate

| # | Check | Pass? |
|---|-------|-------|
| 1 | All overlay files exist | [ ] |
| 2 | All overlays have yuva444p12le pixel format | [ ] |
| 3 | No duplicate md5s among cards | [ ] |
| 4 | Intro/outro text matches current reel | [ ] |
| 5 | All trigger phrases found in .ass captions | [ ] |
| 6 | Music file exists | [ ] |
| 7 | No stale files in slug directory | [ ] |

**All 7 checks must pass before triggering post-processing.**
