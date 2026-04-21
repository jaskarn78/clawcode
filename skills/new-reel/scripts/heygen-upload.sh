#!/usr/bin/env bash
# heygen-upload.sh -- Upload asset to HeyGen /v1/asset with retry
#
# Usage: heygen-upload.sh <file_path> [asset_type]
#   asset_type: "video" (default) or "image"
#
# Output: JSON {"url": "...", "asset_id": "..."}
# Errors: JSON {"error": "..."} on stderr-free failure, exit 1
#
# Requires: HEYGEN_API_KEY environment variable
# Retries:  429/500/502/503 with exponential backoff, max 3 attempts

set -euo pipefail

FILE_PATH="${1:-}"
ASSET_TYPE="${2:-video}"
UPLOAD_URL="https://upload.heygen.com/v1/asset"
MAX_RETRIES=3

# ── Validate inputs ──────────────────────────────────────────────────────────

if [[ -z "${HEYGEN_API_KEY:-}" ]]; then
  echo '{"error":"HEYGEN_API_KEY not set"}'
  exit 1
fi

if [[ -z "$FILE_PATH" ]]; then
  echo '{"error":"Usage: heygen-upload.sh <file_path> [asset_type]"}'
  exit 1
fi

if [[ ! -f "$FILE_PATH" ]]; then
  echo '{"error":"File not found: '"$FILE_PATH"'"}'
  exit 1
fi

# ── Content type ─────────────────────────────────────────────────────────────

CONTENT_TYPE="video/mp4"
if [[ "$ASSET_TYPE" == "image" ]]; then
  CONTENT_TYPE="image/png"
fi

# ── Upload with retry ────────────────────────────────────────────────────────

for attempt in $(seq 0 "$MAX_RETRIES"); do
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$UPLOAD_URL" \
    -H "X-Api-Key: $HEYGEN_API_KEY" \
    -H "Content-Type: $CONTENT_TYPE" \
    --data-binary "@$FILE_PATH")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  case "$HTTP_CODE" in
    200|201)
      URL=$(echo "$BODY" | jq -r '.data.url // .url // empty')
      ASSET_ID=$(echo "$BODY" | jq -r '.data.id // empty')
      echo "{\"url\": \"$URL\", \"asset_id\": \"$ASSET_ID\"}"
      exit 0
      ;;
    429|500|502|503)
      if [[ $attempt -lt $MAX_RETRIES ]]; then
        DELAY=$((2 ** attempt))
        echo "[heygen-upload] Retry $((attempt + 1))/$MAX_RETRIES after ${DELAY}s (HTTP $HTTP_CODE)" >&2
        sleep "$DELAY"
      fi
      ;;
    *)
      SAFE_BODY=$(echo "$BODY" | jq -c '.' 2>/dev/null || echo "\"$BODY\"")
      echo "{\"error\": \"Upload failed: HTTP $HTTP_CODE\", \"body\": $SAFE_BODY}"
      exit 1
      ;;
  esac
done

echo '{"error": "Upload failed after retries"}'
exit 1
