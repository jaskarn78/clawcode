#!/usr/bin/env bash
# jamendo-music.sh -- Search and download background music from Jamendo API
#
# Usage:
#   jamendo-music.sh search "<tags>" <min_duration> [output.mp3]
#   jamendo-music.sh download <track_id> <output.mp3>
#
# Tags examples: "motivational corporate" | "upbeat finance" | "lofi calm" | "inspirational"
# Min duration: seconds (e.g. 45 for a 45s video)
#
# Output (search): JSON {"track_id": "...", "name": "...", "artist": "...", "duration": N, "download_url": "...", "output_path": "..."}
# Requires: JAMENDO_CLIENT_ID environment variable

set -euo pipefail

ACTION="${1:-}"
QUERY="${2:-motivational corporate}"
MIN_DURATION="${3:-40}"
OUTPUT_PATH="${4:-}"

if [[ -z "${JAMENDO_CLIENT_ID:-}" ]]; then
  echo '{"error":"JAMENDO_CLIENT_ID not set"}'
  exit 1
fi

BASE_URL="https://api.jamendo.com/v3.0"

# ── Search ────────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "search" ]]; then
  # Convert space-separated tags to + separated
  TAGS=$(echo "$QUERY" | tr ' ' '+')

  RESPONSE=$(curl -s "${BASE_URL}/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=10&tags=${TAGS}&include=musicinfo&audioformat=mp32&vocalinstrumental=instrumental")

  # Filter by min duration and pick the best match
  TRACK=$(echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
results = data.get('results', [])
min_dur = int('${MIN_DURATION}')
# Filter by duration
valid = [t for t in results if t.get('duration', 0) >= min_dur]
if not valid:
    valid = results  # fallback: ignore duration filter
if not valid:
    print(json.dumps({'error': 'No tracks found for query: ${QUERY}'}))
    sys.exit(1)
# Prefer tracks with CC licenses that allow commercial use
# CC-BY (attribution) or CC-BY-SA are OK; avoid CC-NC (non-commercial)
def score(t):
    lic = t.get('license_ccurl', '')
    # Avoid non-commercial
    if 'nc' in lic.lower():
        return 0
    return 1
valid.sort(key=score, reverse=True)
t = valid[0]
print(json.dumps({
    'track_id': t['id'],
    'name': t['name'],
    'artist': t.get('artist_name', ''),
    'duration': t.get('duration', 0),
    'license': t.get('license_ccurl', ''),
    'download_url': t.get('audiodownload', t.get('audio', '')),
    'share_url': t.get('shareurl', '')
}))
")

  # Check for error
  if echo "$TRACK" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if 'error' not in d else 1)" 2>/dev/null; then
    # Download if output path provided
    if [[ -n "$OUTPUT_PATH" ]]; then
      DL_URL=$(echo "$TRACK" | python3 -c "import json,sys; print(json.load(sys.stdin)['download_url'])")
      curl -sL "$DL_URL" -o "$OUTPUT_PATH"
      echo "$TRACK" | python3 -c "
import json, sys
d = json.load(sys.stdin)
d['output_path'] = '${OUTPUT_PATH}'
print(json.dumps(d))
"
    else
      echo "$TRACK"
    fi
  else
    echo "$TRACK"
    exit 1
  fi

# ── Download by ID ────────────────────────────────────────────────────────────
elif [[ "$ACTION" == "download" ]]; then
  TRACK_ID="$QUERY"   # reuse $2 slot
  OUTPUT_PATH="${3:-/tmp/track_${TRACK_ID}.mp3}"

  # Get track info
  INFO=$(curl -s "${BASE_URL}/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&id=${TRACK_ID}&audioformat=mp32")
  DL_URL=$(echo "$INFO" | python3 -c "import json,sys; r=json.load(sys.stdin)['results']; print(r[0]['audiodownload'] if r else '')")

  if [[ -z "$DL_URL" ]]; then
    echo '{"error":"Track not found or no download URL"}'
    exit 1
  fi

  curl -sL "$DL_URL" -o "$OUTPUT_PATH"
  NAME=$(echo "$INFO" | python3 -c "import json,sys; r=json.load(sys.stdin)['results']; print(r[0]['name'] if r else '')")
  echo "{\"track_id\": \"${TRACK_ID}\", \"name\": \"${NAME}\", \"output_path\": \"${OUTPUT_PATH}\"}"

else
  echo '{"error":"Usage: jamendo-music.sh search|download <query> <min_duration> [output.mp3]"}'
  exit 1
fi
