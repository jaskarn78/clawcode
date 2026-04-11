#!/usr/bin/env bash
# Create a new ClawCode release.
# Usage: bash scripts/release.sh v1.0.0
#        bash scripts/release.sh patch   # auto-bump patch
#        bash scripts/release.sh minor   # auto-bump minor
#        bash scripts/release.sh major   # auto-bump major

set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: bash scripts/release.sh <version|patch|minor|major>"
  echo ""
  echo "Examples:"
  echo "  bash scripts/release.sh v1.0.0"
  echo "  bash scripts/release.sh patch"
  exit 1
fi

# Auto-bump from latest tag
if [[ "$VERSION" =~ ^(patch|minor|major)$ ]]; then
  LATEST=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
  LATEST="${LATEST#v}"
  IFS='.' read -r MAJOR MINOR PATCH <<< "$LATEST"

  case "$VERSION" in
    patch) PATCH=$((PATCH + 1)) ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  esac

  VERSION="v${MAJOR}.${MINOR}.${PATCH}"
fi

# Ensure version starts with v
if [[ "$VERSION" != v* ]]; then
  VERSION="v${VERSION}"
fi

echo "Releasing ${VERSION}..."

# Update package.json version
SEMVER="${VERSION#v}"
npm version "$SEMVER" --no-git-tag-version --allow-same-version

# Commit version bump
git add package.json package-lock.json
git commit -m "chore: release ${VERSION}" || true

# Create tag
git tag -a "$VERSION" -m "Release ${VERSION}"

# Push
git push origin master
git push origin "$VERSION"

echo ""
echo "Release ${VERSION} pushed."
echo "GitHub Actions will create the release automatically."
echo "View at: https://github.com/jaskarn78/clawcode/releases"
