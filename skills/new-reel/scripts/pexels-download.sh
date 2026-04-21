#!/usr/bin/env bash
# pexels-download.sh -- Search Pexels and download portrait HD video
#
# Usage:
#   pexels-download.sh search <query> <min_duration> <output_path>
#   pexels-download.sh download <video_url> <output_path>
#
# search: Finds first portrait HD video (height >= 1920, width <= height)
#         matching query with duration >= min_duration seconds
#         Output: JSON {"video_id": N, "download_link": "...", "duration": N, "width": N, "height": N}
#
# download: Downloads video from URL to output_path
#           Output: JSON {"output_path": "...", "size_bytes": N}
#
# Requires: PEXELS_API_KEY environment variable
# Note: Pexels uses Authorization header (not X-Api-Key)
# Retries: 429/500/502/503 with exponential backoff, max 3 attempts

set -euo pipefail

PEXELS_SEARCH_URL="https://api.pexels.com/videos/search"
MAX_RETRIES=3

# ── Validate API key ────────────────────────────────────────────────────────

if [[ -z "${PEXELS_API_KEY:-}" ]]; then
  echo '{"error":"PEXELS_API_KEY not set"}'
  exit 1
fi

COMMAND="${1:-}"

case "$COMMAND" in
  search)
    QUERY="${2:-}"
    MIN_DURATION="${3:-0}"
    OUTPUT_PATH="${4:-}"

    if [[ -z "$QUERY" ]]; then
      echo '{"error":"Usage: pexels-download.sh search <query> <min_duration> <output_path>"}'
      exit 1
    fi

    # ── Search with retry ──────────────────────────────────────────────────

    BODY=""
    for attempt in $(seq 0 "$MAX_RETRIES"); do
      RESPONSE=$(curl -s -w "\n%{http_code}" \
        -G "$PEXELS_SEARCH_URL" \
        -H "Authorization: $PEXELS_API_KEY" \
        --data-urlencode "query=$QUERY" \
        --data-urlencode "orientation=portrait" \
        --data-urlencode "size=medium" \
        --data-urlencode "per_page=5")

      HTTP_CODE=$(echo "$RESPONSE" | tail -1)
      BODY=$(echo "$RESPONSE" | sed '$d')

      case "$HTTP_CODE" in
        200)
          break
          ;;
        429|500|502|503)
          if [[ $attempt -lt $MAX_RETRIES ]]; then
            DELAY=$((2 ** attempt))
            echo "[pexels-download] Retry $((attempt + 1))/$MAX_RETRIES after ${DELAY}s (HTTP $HTTP_CODE)" >&2
            sleep "$DELAY"
          fi
          if [[ $attempt -eq $MAX_RETRIES ]]; then
            echo '{"error":"Pexels search failed after retries"}'
            exit 1
          fi
          ;;
        *)
          echo "{\"error\": \"Pexels search failed: HTTP $HTTP_CODE\"}"
          exit 1
          ;;
      esac
    done

    # ── Filter: portrait HD, minimum duration ────────────────────────────

    RESULT=$(echo "$BODY" | jq -c --argjson min_dur "$MIN_DURATION" '
      [.videos[] |
        select(.duration >= $min_dur) |
        . as $v |
        .video_files[] |
        select(.height >= 1920 and .width <= .height) |
        {
          video_id: $v.id,
          download_link: .link,
          duration: $v.duration,
          width: .width,
          height: .height
        }
      ] | first // empty
    ')

    if [[ -z "$RESULT" ]]; then
      echo '{"error":"No suitable portrait video found"}'
      exit 1
    fi

    # If output_path provided, auto-download
    if [[ -n "$OUTPUT_PATH" ]]; then
      DOWNLOAD_LINK=$(echo "$RESULT" | jq -r '.download_link')
      curl -s -L -o "$OUTPUT_PATH" "$DOWNLOAD_LINK"
      if [[ -f "$OUTPUT_PATH" && $(stat -c%s "$OUTPUT_PATH" 2>/dev/null || stat -f%z "$OUTPUT_PATH" 2>/dev/null) -gt 0 ]]; then
        SIZE=$(stat -c%s "$OUTPUT_PATH" 2>/dev/null || stat -f%z "$OUTPUT_PATH" 2>/dev/null)
        echo "$RESULT" | jq -c --arg p "$OUTPUT_PATH" --argjson s "$SIZE" '. + {output_path: $p, size_bytes: $s}'
      else
        echo '{"error":"Download failed: file empty or missing"}'
        exit 1
      fi
    else
      echo "$RESULT"
    fi
    ;;

  download)
    VIDEO_URL="${2:-}"
    OUTPUT_PATH="${3:-}"

    if [[ -z "$VIDEO_URL" || -z "$OUTPUT_PATH" ]]; then
      echo '{"error":"Usage: pexels-download.sh download <video_url> <output_path>"}'
      exit 1
    fi

    curl -s -L -o "$OUTPUT_PATH" "$VIDEO_URL"

    if [[ ! -f "$OUTPUT_PATH" ]]; then
      echo '{"error":"Download failed: file not created"}'
      exit 1
    fi

    SIZE=$(stat -c%s "$OUTPUT_PATH" 2>/dev/null || stat -f%z "$OUTPUT_PATH" 2>/dev/null)
    if [[ "$SIZE" -eq 0 ]]; then
      echo '{"error":"Download failed: file is empty"}'
      rm -f "$OUTPUT_PATH"
      exit 1
    fi

    echo "{\"output_path\": \"$OUTPUT_PATH\", \"size_bytes\": $SIZE}"
    ;;

  *)
    echo '{"error":"Unknown command: '"$COMMAND"'. Usage: pexels-download.sh search|download ..."}'
    exit 1
    ;;
esac
