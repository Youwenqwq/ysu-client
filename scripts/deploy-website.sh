#!/usr/bin/env bash
set -euo pipefail

REPO="Youwenqwq/ysu-client"

echo "Building website..."
cd website
npm run build
cd ..

# Fetch latest OTA files from GitHub release so download page keeps working
echo "Fetching latest OTA files from GitHub release..."
LATEST_TAG=$(gh release list --repo "$REPO" --limit 1 --json tagName -q '.[0].tagName' 2>/dev/null || true)

if [[ -n "${LATEST_TAG:-}" ]]; then
  mkdir -p website/dist/updates
  gh release download "$LATEST_TAG" --repo "$REPO" \
    --pattern "dist.zip" --pattern "app-release.apk" --pattern "version.json" \
    --dir website/dist/updates/ 2>/dev/null || true
else
  echo "Warning: no GitHub release found, skipping OTA files."
fi

echo ""
echo "========================================"
echo "Deploying website to EdgeOne Pages..."
echo "========================================"
export PAGES_SOURCE=skills
cd website
edgeone pages deploy dist
cd ..

echo "Website deployed!"
