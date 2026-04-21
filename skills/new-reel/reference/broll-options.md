# B-Roll Options Reference

> **Path B and Path C only.** This file covers scene background assets that get uploaded to HeyGen and referenced as `video_asset_id` in the payload. For Path A (single-scene template + floating cards), skip this file entirely — floating cards are composited in post-processing and never touch HeyGen. See `card-gallery.md` for card types.

---

## Option A: Remotion Animation (Scene Backgrounds)

Animated graphics rendered on the Unraid container and uploaded to HeyGen as scene backgrounds. These appear behind the avatar in multi-scene reels.

### Rendering on the Container

All Remotion renders happen on the Unraid container — **never locally**. Submit a `render_and_upload` job to get a rendered asset uploaded to HeyGen in one shot:

```bash
# Render + upload to HeyGen (returns asset_id)
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

Response includes `asset_id` — use directly as `video_asset_id` in the HeyGen payload. Never use `url` (causes pillarboxing).

If you need render-only (no upload):

```bash
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
```

Output lands at `/work/<slug>/<name>.mov` inside the container.

### Available Scene Background Templates

These are full-screen animated backgrounds for multi-scene reels. Each renders at 1080x1920.

| Template | Best For |
|----------|----------|
| `ComparisonBars` | A vs B bar chart (fees, returns, costs) |
| `GrowthCurve` | Compound growth curve over time |
| `DualGrowthCurve` | Two-line growth comparison |
| `NumberReveal` | Single stat reveal with counter animation |
| `ChecklistReveal` | Animated checklist with check/X icons. **4+ items + zoneB:** last item renders as 45% width right-aligned tile beside avatar |
| `StatGrid` | Adaptive stat grid — 4 items: 2x2. **3 items + zoneB: L-shape layout** (2 tall cards top + 1 featured card beside avatar) |
| `TimelineReveal` | Vertical timeline with milestone markers. No zoneB or summaryText — items alternate left/right, always ending right |
| `MythVsFact` | Two-panel myth vs fact comparison |
| `QuoteReveal` | Word-by-word quote reveal with attribution |
| `RankingList` | Top N ranked items with animated bars |
| `PieBreakdown` | Donut chart with segment labels |
| `BeforeAfter` | Side-by-side before/after comparison |

> **FloatingCard is NOT a scene background.** `FloatingCard` overlays (stat, comparison, list, benefits, chart, accumulator, ageComparison, stackedTotal, qualifier, ruleHighlight) are rendered as post-processing overlays for Path A reels. See `card-gallery.md` for the full card type gallery.

### StockFootageOverlay Template

Any chart type can be rendered over Pexels stock footage via the `StockFootageOverlay` Remotion template. Pass `chartType` and chart-specific props. Glassmorphic panels auto-apply over video for readability.

**Supported `chartType` values:**

| chartType | Description |
|-----------|-------------|
| `checklist` | Animated checklist |
| `comparison` | A vs B bars |
| `number` | Single stat reveal |
| `growth` | Growth curve |
| `dualgrowth` | Two-line growth |
| `timeline` | Vertical timeline |
| `statgrid` | Stat grid layout |
| `mythvsfact` | Myth vs fact panels |
| `quote` | Quote reveal |
| `ranking` | Top N ranked items |
| `pie` | Donut chart |
| `beforeafter` | Before/after comparison |

To render a StockFootageOverlay on the container, the stock footage must be at `/work/remotion-banner/public/<filename>.mp4` inside the container. Copy Pexels downloads there first:

```bash
# Download stock footage
bash ${CLAUDE_SKILL_DIR}/scripts/pexels-download.sh search "<query>" <min_duration> /tmp/pexels-clip.mp4

# Copy to container's Remotion public dir
scp /tmp/pexels-clip.mp4 root@100.117.234.17:/mnt/user/appdata/finmentum-post/work/remotion-banner/public/<versioned-name>.mp4

# Then render with StockFootageOverlay, passing videoSrc as filename only
curl -s http://100.117.234.17:8082/webhook/process \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "type": "render_and_upload",
    "slug": "<slug>",
    "composition_id": "StockFootageOverlay",
    "props": {
      "videoSrc": "<versioned-name>.mp4",
      "chartType": "growth",
      ...chart props...
    },
    "duration_frames": 175,
    "fps": 25,
    "format": "prores_4444",
    "output": "scene2-bg.mov"
  }'
```

> `videoSrc` must be a **filename only** (relative to `public/`), NOT an absolute path. Remotion resolves it via `staticFile()`.

### Template Props

All scene background templates use:
- `SAFE_TOP = 80px` top margin to clear phone status bar and Instagram top UI
- 5% internal padding (`Math.min(width, height) * 0.05`)
- Proportional font sizes scaled to `area.height`
- Full available area from safe zone calculations
- `availableArea` and `zoneB` props from position registry for two-zone layout

### zoneBContent Override

Templates support an optional `zoneBContent` prop to override the default Zone B content:
```json
{
  "zoneBContent": {
    "title": "PROJECTED",
    "value": "$1,331",
    "subtext": "after 4 years"
  }
}
```
When omitted, each template generates its own contextual Zone B content. Set this in the scene's project JSON when the auto-generated content doesn't fit.

---

## Option B: Pexels Stock Footage (No Chart Overlay)

Raw stock footage as a scene background — no Remotion chart overlay. Good for lifestyle, abstract, or establishing shots.

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/pexels-download.sh search "<query>" <min_duration> working/<slug>/pexels-scene<N>.mp4
```

Upload to HeyGen via the container's n8n workflow:

```bash
# Copy to container first
scp working/<slug>/pexels-scene<N>.mp4 root@100.117.234.17:/mnt/user/appdata/finmentum-post/work/<slug>/pexels-scene<N>.mp4

# Upload via n8n
curl -s http://100.117.234.17:5678/webhook/heygen-asset-upload \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "file_path": "/work/<slug>/pexels-scene<N>.mp4",
    "asset_type": "video"
  }'
```

Use the returned `asset_id` as `video_asset_id` in the HeyGen scene background. Never use `url`.

### Pexels Search Tips

- Keep queries to 2-3 words max
- Add "vertical" or "portrait" for better 9:16 results
- Good queries for Finmentum: "family finances", "young professional", "retirement couple", "piggy bank", "stock market", "house keys"
- Minimum duration should match the scene duration + 2s buffer

---

## Render Format Notes

- Container uses `--prores-profile=4444 --image-format=png --pixel-format=yuva444p10le` internally
- `--image-format=png` is required for true alpha — without it, Remotion renders JPEG frames (no alpha)
- Verify output format: `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt,codec_name -of csv=p=0 <file>.mov`
- Expected: `prores,yuva444p12le`

## Asset Cache

The container caches uploaded asset IDs at `/work/asset-cache.json`. Re-submitting the same render won't re-upload — it returns the cached `asset_id`.
