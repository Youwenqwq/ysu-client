#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
REPO="Youwenqwq/ysu-client"

# Preflight: ensure gh is authenticated
gh auth status || { echo "Error: gh CLI not authenticated. Run 'gh auth login'."; exit 1; }

# Temp file cleanup trap
cleanup() {
  [[ -n "${TMP_NOTES:-}" ]] && rm -f "$TMP_NOTES"
}
trap cleanup EXIT

echo "Building version ${VERSION}..."
npm run build

echo "Creating dist.zip..."
cd dist
zip -r ../dist.zip . -x '*.DS_Store'
cd ..

echo "Building Android APK..."
npx cap sync
cd android
./gradlew assembleRelease
cd ..
APK_PATH="android/app/build/outputs/apk/release/app-release.apk"

# Read versionName from build.gradle and compute versionCode
APK_VERSION_NAME=$(grep 'versionName' android/app/build.gradle | grep -oP '"[0-9]+\.[0-9]+\.[0-9]+"' | tr -d '"')
IFS='.' read -r V_MAJOR V_MINOR V_PATCH <<< "${APK_VERSION_NAME}"
APK_VERSION_CODE=$(( V_MAJOR * 10000 + V_MINOR * 100 + V_PATCH ))

echo "Creating GitHub release ${TAG}..."
gh release create "${TAG}" dist.zip "${APK_PATH}" \
  --title "${TAG}" \
  --generate-notes \
  --latest

echo "Fetching release notes..."
TMP_NOTES=$(mktemp)
gh release view "${TAG}" --json body -q '.body' > "$TMP_NOTES" || true

if [[ -t 0 ]] && [[ -z "${CI:-}" ]]; then
  echo "Opening editor for release notes..."
  ${EDITOR:-nano} "$TMP_NOTES"
fi

# Sync edited notes back to the GitHub release
gh release edit "${TAG}" --notes-file "$TMP_NOTES"

BODY=$(cat "$TMP_NOTES")
rm "$TMP_NOTES"

echo "Generating version.json with release notes..."
cat > version.json <<EOF
{
  "apkVersionCode": ${APK_VERSION_CODE},
  "webVersion": "${VERSION}",
  "apkDownloadUrl": "https://github.com/${REPO}/releases/download/${TAG}/app-release.apk",
  "body": $(echo "$BODY" | jq -Rs .)
}
EOF

echo "Uploading version.json..."
gh release upload "${TAG}" version.json --clobber

echo "Release ${TAG} published!"
rm dist.zip version.json
