#!/usr/bin/env bash
# heygen-submit.sh -- Submit render payload to HeyGen /v2/video/generate
#
# Usage: heygen-submit.sh <payload_json_path>
#
# Output: JSON {"video_id": "..."}
# Errors: JSON {"error": "..."} on failure, exit 1
#
# Requires: HEYGEN_API_KEY environment variable
# Retries:  429/500/502/503 with exponential backoff, max 3 attempts

set -euo pipefail

PAYLOAD_PATH="${1:-}"
SUBMIT_URL="https://api.heygen.com/v2/video/generate"
MAX_RETRIES=3

# ── Validate inputs ──────────────────────────────────────────────────────────

if [[ -z "${HEYGEN_API_KEY:-}" ]]; then
  echo '{"error":"HEYGEN_API_KEY not set"}'
  exit 1
fi

if [[ -z "$PAYLOAD_PATH" ]]; then
  echo '{"error":"Usage: heygen-submit.sh <payload_json_path>"}'
  exit 1
fi

if [[ ! -f "$PAYLOAD_PATH" ]]; then
  echo '{"error":"Payload file not found: '"$PAYLOAD_PATH"'"}'
  exit 1
fi

# ── Submit with retry ────────────────────────────────────────────────────────

for attempt in $(seq 0 "$MAX_RETRIES"); do
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$SUBMIT_URL" \
    -H "X-Api-Key: $HEYGEN_API_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "@$PAYLOAD_PATH")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  case "$HTTP_CODE" in
    200|201)
      VIDEO_ID=$(echo "$BODY" | jq -r '.data.video_id // empty')
      if [[ -z "$VIDEO_ID" ]]; then
        echo '{"error":"No video_id in response","body":'"$(echo "$BODY" | jq -c '.' 2>/dev/null || echo "\"$BODY\"")"'}'
        exit 1
      fi
      echo "{\"video_id\": \"$VIDEO_ID\"}"
      exit 0
      ;;
    400|401|403)
      SAFE_BODY=$(echo "$BODY" | jq -c '.' 2>/dev/null || echo "\"$BODY\"")
      echo "{\"error\": \"Render rejected: HTTP $HTTP_CODE\", \"body\": $SAFE_BODY}"
      exit 1
      ;;
    429|500|502|503)
      if [[ $attempt -lt $MAX_RETRIES ]]; then
        DELAY=$((2 ** attempt))
        echo "[heygen-submit] Retry $((attempt + 1))/$MAX_RETRIES after ${DELAY}s (HTTP $HTTP_CODE)" >&2
        sleep "$DELAY"
      fi
      ;;
    *)
      SAFE_BODY=$(echo "$BODY" | jq -c '.' 2>/dev/null || echo "\"$BODY\"")
      echo "{\"error\": \"Submit failed: HTTP $HTTP_CODE\", \"body\": $SAFE_BODY}"
      exit 1
      ;;
  esac
done

echo '{"error": "Submit failed after retries"}'
exit 1
