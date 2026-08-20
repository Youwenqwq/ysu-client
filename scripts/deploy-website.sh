#!/usr/bin/env bash
set -euo pipefail

REPO="Youwenqwq/ysu-client"

TMP_RELEASE_DIR=""
cleanup() {
  [[ -n "${TMP_RELEASE_DIR:-}" ]] && rm -rf "$TMP_RELEASE_DIR"
}
trap cleanup EXIT

# Fetch latest stable OTA files from GitHub release so download page keeps working.
# Prerelease bundles are versioned as dist-<version>.zip and are preserved locally.
echo "Fetching latest stable OTA files from GitHub release..."
LATEST_TAG=$(gh api "repos/${REPO}/releases/latest" -q '.tag_name' 2>/dev/null || true)

if [[ -n "${LATEST_TAG:-}" ]]; then
  mkdir -p website/public/updates
  TMP_RELEASE_DIR=$(mktemp -d)
  gh release download "$LATEST_TAG" --repo "$REPO" \
    --pattern "dist.zip" --pattern "app-release*.apk" --pattern "version.json" \
    --dir "$TMP_RELEASE_DIR" 2>/dev/null || true

  [[ -f "$TMP_RELEASE_DIR/dist.zip" ]] && cp "$TMP_RELEASE_DIR/dist.zip" website/public/updates/dist.zip
  STABLE_APK=$(find "$TMP_RELEASE_DIR" -maxdepth 1 -name 'app-release*.apk' -print -quit)
  [[ -n "${STABLE_APK:-}" ]] && cp "$STABLE_APK" website/public/updates/app-release.apk

  if [[ -f "$TMP_RELEASE_DIR/version.json" ]]; then
    if [[ -f website/public/updates/version.json ]]; then
      jq -s '
        .[0] as $fresh |
        .[1] as $existing |
        if ($existing.channels.prerelease? != null) then
          $fresh | .channels = ((.channels // {}) + { prerelease: $existing.channels.prerelease })
        else
          $fresh
        end
      ' "$TMP_RELEASE_DIR/version.json" website/public/updates/version.json > "$TMP_RELEASE_DIR/version-merged.json"
      cp "$TMP_RELEASE_DIR/version-merged.json" website/public/updates/version.json
    else
      cp "$TMP_RELEASE_DIR/version.json" website/public/updates/version.json
    fi
  fi
else
  echo "Warning: no stable GitHub release found, skipping OTA files."
fi

# Build the web app and inject it into the site bundle at /app.
# APP_BASE_PATH makes Next.js emit /app-prefixed asset URLs;
# the app talks to the same-origin edge proxy at /api/proxy.
echo ""
echo "Building web app bundle..."
APP_BASE_PATH=/app pnpm run build
rm -rf website/public/app
mkdir -p website/public/app
cp -r dist/. website/public/app/

echo ""
echo "========================================"
echo "Deploying website to EdgeOne Pages..."
echo "========================================"
rm -rf .edgeone
export PAGES_SOURCE=skills
cd website
edgeone makers deploy
cd ..

echo "Website deployed!"
