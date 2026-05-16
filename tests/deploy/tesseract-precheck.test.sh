#!/usr/bin/env bash
# Phase 101 T06 smoke test for the tesseract-ocr precheck in
# scripts/deploy-clawdy.sh.
#
# This is a one-shot human-run smoke test (the deploy script itself is
# operator-only — never wired into CI). It verifies:
#
#   1. `bash -n scripts/deploy-clawdy.sh` is syntactically valid
#   2. The precheck block exists (grep `tesseract` in the deploy script)
#   3. The hint message format documents the apt-install fix
#
# Run manually:   bash tests/deploy/tesseract-precheck.test.sh
# Expected exit:  0 on pass, 1 on any failure with a diagnostic line.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY="$SCRIPT_DIR/scripts/deploy-clawdy.sh"

if [ ! -f "$DEPLOY" ]; then
  echo "FAIL: $DEPLOY not found" >&2
  exit 1
fi

# 1. syntax check
if ! bash -n "$DEPLOY"; then
  echo "FAIL: bash -n syntax error" >&2
  exit 1
fi
echo "PASS: bash -n syntax-ok"

# 2. precheck block present
if ! grep -q "tesseract" "$DEPLOY"; then
  echo "FAIL: tesseract precheck block missing from deploy script" >&2
  exit 1
fi
TESSERACT_COUNT=$(grep -v '^#' "$DEPLOY" | grep -c "tesseract" || true)
if [ "$TESSERACT_COUNT" -lt 2 ]; then
  echo "FAIL: expected ≥2 non-comment tesseract occurrences, got $TESSERACT_COUNT" >&2
  exit 1
fi
echo "PASS: tesseract precheck present ($TESSERACT_COUNT non-comment refs)"

# 3. apt-install hint format
if ! grep -q "apt-get install -y tesseract-ocr" "$DEPLOY"; then
  echo "FAIL: apt-install hint missing from precheck error message" >&2
  exit 1
fi
echo "PASS: apt-install hint present"

# 4. Phase 101 D-01 marker (operator grep target)
if ! grep -q "Phase 101 D-01" "$DEPLOY"; then
  echo "FAIL: 'Phase 101 D-01' marker missing" >&2
  exit 1
fi
echo "PASS: Phase 101 D-01 marker present"

echo "OK: tesseract precheck smoke test passed"
