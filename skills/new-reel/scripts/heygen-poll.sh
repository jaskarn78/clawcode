#!/usr/bin/env bash
# heygen-poll.sh -- Poll HeyGen video status, download on completion
#
# Usage: heygen-poll.sh <video_id> <output_dir>
#
# Designed for Claude Code run_in_background -- all output goes to known file paths.
# Writes status to $OUTPUT_DIR/heygen-status.json throughout lifecycle.
#
# Statuses written: polling -> completed|failed|timeout
#
# Requires: HEYGEN_API_KEY environment variable
# Poll interval: 10 seconds
# Max wait: 600 seconds (10 minutes)

set -euo pipefail

VIDEO_ID="${1:-}"
OUTPUT_DIR="${2:-}"
POLL_URL="https://api.heygen.com/v1/video_status.get"
MAX_WAIT=600
INTERVAL=10

# ── Validate inputs ──────────────────────────────────────────────────────────

if [[ -z "${HEYGEN_API_KEY:-}" ]]; then
  echo '{"error":"HEYGEN_API_KEY not set"}'
  exit 1
fi

if [[ -z "$VIDEO_ID" ]]; then
  echo '{"error":"Usage: heygen-poll.sh <video_id> <output_dir>"}'
  exit 1
fi

if [[ -z "$OUTPUT_DIR" ]]; then
  echo '{"error":"Usage: heygen-poll.sh <video_id> <output_dir>"}'
  exit 1
fi

# ── Setup ────────────────────────────────────────────────────────────────────

mkdir -p "$OUTPUT_DIR"
STATUS_FILE="$OUTPUT_DIR/heygen-status.json"

echo '{"status":"polling","video_id":"'"$VIDEO_ID"'"}' > "$STATUS_FILE"
echo "[heygen-poll] Polling video_id=$VIDEO_ID (max ${MAX_WAIT}s, every ${INTERVAL}s)"

# ── Poll loop ────────────────────────────────────────────────────────────────

START=$(date +%s)

while true; do
  ELAPSED=$(( $(date +%s) - START ))

  if [[ $ELAPSED -gt $MAX_WAIT ]]; then
    echo '{"status":"timeout","video_id":"'"$VIDEO_ID"'"}' > "$STATUS_FILE"
    echo "[heygen-poll] Timeout after ${MAX_WAIT}s for video_id=$VIDEO_ID"
    exit 1
  fi

  BODY=$(curl -s "$POLL_URL?video_id=$VIDEO_ID" \
    -H "X-Api-Key: $HEYGEN_API_KEY" \
    -H "Accept: application/json")

  STATUS=$(echo "$BODY" | jq -r '.data.status // "unknown"')
  ELAPSED_MIN=$(awk "BEGIN {printf \"%.1f\", $ELAPSED / 60}")

  case "$STATUS" in
    completed)
      VIDEO_URL=$(echo "$BODY" | jq -r '.data.video_url')
      OUTPUT_PATH="$OUTPUT_DIR/heygen_${VIDEO_ID}.mp4"

      echo "[heygen-poll] [$ELAPSED_MIN min] Status: completed -- downloading..."
      curl -s -o "$OUTPUT_PATH" "$VIDEO_URL"

      echo "{\"status\":\"completed\",\"video_id\":\"$VIDEO_ID\",\"output_path\":\"$OUTPUT_PATH\",\"video_url\":\"$VIDEO_URL\"}" > "$STATUS_FILE"
      echo "[heygen-poll] Render complete! Downloaded to $OUTPUT_PATH"
      exit 0
      ;;
    failed)
      ERROR=$(echo "$BODY" | jq -r '.data.error // "unknown"')
      echo "{\"status\":\"failed\",\"video_id\":\"$VIDEO_ID\",\"error\":\"$ERROR\"}" > "$STATUS_FILE"
      echo "[heygen-poll] [$ELAPSED_MIN min] Render FAILED: $ERROR"
      exit 1
      ;;
    *)
      echo "[heygen-poll] [$ELAPSED_MIN min] Status: $STATUS"
      sleep "$INTERVAL"
      ;;
  esac
done
