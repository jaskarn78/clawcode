#!/usr/bin/env bash
# upload-cache.sh -- SHA-256 content-hash cache for uploaded assets
#
# Usage:
#   upload-cache.sh get <file_path>              # Returns cached JSON or exits silently
#   upload-cache.sh set <file_path> <url> [asset_id]  # Store entry in cache
#
# Cache file: ${SKILL_CACHE_DIR:-.claude/skills/new-reel}/.asset_cache.json
# TTL: 604800 seconds (7 days)
#
# get: prints full entry JSON on hit, exits 0 silently on miss/expired
# set: adds/updates entry with url, asset_id, uploaded_at timestamp

set -euo pipefail

CACHE_FILE="${SKILL_CACHE_DIR:-.claude/skills/new-reel}/.asset_cache.json"
TTL=604800  # 7 days in seconds

COMMAND="${1:-}"

case "$COMMAND" in
  get)
    FILE_PATH="${2:-}"
    if [[ -z "$FILE_PATH" ]]; then
      echo '{"error":"Usage: upload-cache.sh get <file_path>"}'
      exit 1
    fi
    if [[ ! -f "$FILE_PATH" ]]; then
      echo '{"error":"File not found: '"$FILE_PATH"'"}'
      exit 1
    fi

    HASH=$(sha256sum "$FILE_PATH" | cut -d' ' -f1)

    # Cache miss: file doesn't exist
    [[ ! -f "$CACHE_FILE" ]] && exit 0

    # Cache miss: key not found
    ENTRY=$(jq -r --arg h "$HASH" '.[$h] // empty' "$CACHE_FILE")
    [[ -z "$ENTRY" ]] && exit 0

    # Cache miss: TTL expired
    UPLOADED_AT=$(echo "$ENTRY" | jq -r '.uploaded_at')
    NOW=$(date +%s)
    if [[ $(( NOW - ${UPLOADED_AT%.*} )) -gt $TTL ]]; then
      exit 0
    fi

    # Cache hit: print full entry
    echo "$ENTRY"
    ;;

  set)
    FILE_PATH="${2:-}"
    URL="${3:-}"
    ASSET_ID="${4:-}"

    if [[ -z "$FILE_PATH" || -z "$URL" ]]; then
      echo '{"error":"Usage: upload-cache.sh set <file_path> <url> [asset_id]"}'
      exit 1
    fi
    if [[ ! -f "$FILE_PATH" ]]; then
      echo '{"error":"File not found: '"$FILE_PATH"'"}'
      exit 1
    fi

    HASH=$(sha256sum "$FILE_PATH" | cut -d' ' -f1)
    NOW=$(date +%s)

    # Ensure cache directory and file exist
    mkdir -p "$(dirname "$CACHE_FILE")"
    [[ ! -f "$CACHE_FILE" ]] && echo '{}' > "$CACHE_FILE"

    # Atomic update: write to temp then move
    jq --arg h "$HASH" --arg u "$URL" --arg a "$ASSET_ID" --argjson t "$NOW" \
      '. + {($h): {"url": $u, "asset_id": $a, "uploaded_at": $t}}' \
      "$CACHE_FILE" > "${CACHE_FILE}.tmp" && mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
    ;;

  *)
    echo '{"error":"Unknown command: '"$COMMAND"'. Usage: upload-cache.sh get|set <file_path> ..."}'
    exit 1
    ;;
esac
