#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
REPO="Youwenqwq/ysu-client"
OFFICIAL_UPDATES_BASE="https://ysu.welain.com/updates/"
IS_PRERELEASE=$(node - <<'NODE'
const semver = require('semver');
const version = require('./package.json').version;
if (!semver.valid(version)) {
  console.error(`Error: package.json version '${version}' is not valid SemVer.`);
  process.exit(1);
}
process.stdout.write(semver.prerelease(version) ? 'true' : 'false');
NODE
)

RELEASE_CHANNEL="stable"
if [[ "${IS_PRERELEASE}" == "true" ]]; then
  RELEASE_CHANNEL="prerelease"
fi

if [[ -t 0 ]] && [[ -z "${CI:-}" ]]; then
  echo "Detected release channel: ${RELEASE_CHANNEL}"
  echo "Version: ${VERSION}"
  read -p "Continue? [y/N] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Release cancelled."
    exit 0
  fi
else
  echo "Detected release channel: ${RELEASE_CHANNEL} (${VERSION})"
fi

# Preflight checks
echo "Running preflight checks..."

# Ensure gh is authenticated
gh auth status || { echo "Error: gh CLI not authenticated. Run 'gh auth login'."; exit 1; }

# Ensure on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "${CURRENT_BRANCH}" != "main" ]]; then
  echo "Error: Must be on main branch, currently on '${CURRENT_BRANCH}'."
  exit 1
fi

# Ensure working directory is clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: Working directory has uncommitted changes. Commit or stash them first."
  exit 1
fi

# Ensure current commit is pushed to origin
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/main 2>/dev/null || echo "")
if [[ "${LOCAL_COMMIT}" != "${REMOTE_COMMIT}" ]]; then
  echo "Error: Current commit is not pushed to origin/main. Push first: git push origin main"
  exit 1
fi

# Ensure tag does not already exist (local or remote)
if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "Error: Tag ${TAG} already exists locally."
  exit 1
fi
if git ls-remote --tags origin "refs/tags/${TAG}" | grep -q .; then
  echo "Error: Tag ${TAG} already exists on remote."
  exit 1
fi

echo "Preflight checks passed."

# Temp file cleanup trap
cleanup() {
  [[ -n "${TMP_NOTES:-}" ]] && rm -f "$TMP_NOTES"
  [[ -n "${TMP_VERSION_BASE:-}" ]] && rm -f "$TMP_VERSION_BASE"
  rm -rf .edgeone
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

# Read numeric versionName from build.gradle and compute versionCode.
# Android versionName intentionally remains major.minor.patch even for web prereleases.
APK_VERSION_NAME=$(grep 'versionName' android/app/build.gradle | grep -oP '"[0-9]+\.[0-9]+\.[0-9]+"' | tr -d '"')
IFS='.' read -r V_MAJOR V_MINOR V_PATCH <<< "${APK_VERSION_NAME}"
APK_VERSION_CODE=$(( V_MAJOR * 10000 + V_MINOR * 100 + V_PATCH ))

RELEASE_FLAGS=(--latest)
if [[ "${IS_PRERELEASE}" == "true" ]]; then
  RELEASE_FLAGS=(--prerelease)
fi

echo "Creating GitHub release ${TAG}..."
gh release create "${TAG}" dist.zip "${APK_PATH}" \
  --target "$(git rev-parse HEAD)" \
  --title "${TAG}" \
  --generate-notes \
  "${RELEASE_FLAGS[@]}"

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
TMP_NOTES=""

TMP_VERSION_BASE=$(mktemp)
if [[ -f website/public/updates/version.json ]]; then
  cp website/public/updates/version.json "$TMP_VERSION_BASE"
else
  echo '{}' > "$TMP_VERSION_BASE"
fi

APK_DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/app-release.apk"
PRERELEASE_DIST_NAME="dist-${VERSION}.zip"
PRERELEASE_DIST_URL="${OFFICIAL_UPDATES_BASE}${PRERELEASE_DIST_NAME}"

echo "Generating version.json with release notes..."
if [[ "${IS_PRERELEASE}" == "true" ]]; then
  jq \
    --arg webVersion "$VERSION" \
    --arg webDownloadUrl "$PRERELEASE_DIST_URL" \
    --arg body "$BODY" \
    '.channels = ((.channels // {}) + {
      prerelease: {
        webVersion: $webVersion,
        webDownloadUrl: $webDownloadUrl,
        body: $body
      }
    })' \
    "$TMP_VERSION_BASE" > version.json
else
  jq \
    --arg webVersion "$VERSION" \
    --arg apkDownloadUrl "$APK_DOWNLOAD_URL" \
    --arg body "$BODY" \
    --argjson apkVersionCode "$APK_VERSION_CODE" \
    '. + {
      apkVersionCode: $apkVersionCode,
      webVersion: $webVersion,
      apkDownloadUrl: $apkDownloadUrl,
      body: $body
    }
    | .channels = ((.channels // {}) + {
      stable: {
        apkVersionCode: $apkVersionCode,
        webVersion: $webVersion,
        apkDownloadUrl: $apkDownloadUrl,
        body: $body
      }
    })' \
    "$TMP_VERSION_BASE" > version.json
fi

echo "Uploading version.json..."
gh release upload "${TAG}" version.json --clobber

# Generate changelog.json from GitHub releases
echo "Generating changelog.json..."
gh api "repos/${REPO}/releases" | jq 'map({
  version: (.tag_name | ltrimstr("v")),
  date: (.published_at | fromdateiso8601 + 28800 | strftime("%Y-%m-%d")),
  body: .body
})' > website/src/data/changelog.json

# Copy OTA files to website dist
mkdir -p website/public/updates
if [[ "${IS_PRERELEASE}" == "true" ]]; then
  cp dist.zip "website/public/updates/${PRERELEASE_DIST_NAME}"
  cp version.json website/public/updates/
else
  cp dist.zip website/public/updates/
  cp "${APK_PATH}" website/public/updates/app-release.apk
  cp version.json website/public/updates/
fi

# Announcement management
edit_announcement() {
  local file="$1"
  local tmpfile
  tmpfile=$(mktemp)

  if [[ -f "$file" ]]; then
    cp "$file" "$tmpfile"
  else
    local now expire
    now=$(node -e "console.log(new Date().toISOString())")
    expire=$(node -e "const d = new Date(); d.setUTCDate(d.getUTCDate() + 7); console.log(d.toISOString())")
    cat > "$tmpfile" <<EOF
{
  "id": "$(date +%Y%m%d-%H%M%S)",
  "title": "公告标题",
  "content": "公告内容，支持 **Markdown** 格式。",
  "level": "info",
  "publishedAt": "${now}",
  "expireAt": "${expire}"
}
EOF
  fi

  ${EDITOR:-nano} "$tmpfile"

  if ! jq empty "$tmpfile" 2>/dev/null; then
    echo "Error: Invalid JSON. Aborting."
    rm -f "$tmpfile"
    return 1
  fi

  if ! jq -e '.id and .title and .content and .level and .expireAt' "$tmpfile" >/dev/null 2>&1; then
    echo "Error: Missing required fields (id, title, content, level, expireAt). Aborting."
    rm -f "$tmpfile"
    return 1
  fi

  mv "$tmpfile" "$file"
  echo "Announcement saved."
}

ANNOUNCEMENT_FILE="website/public/updates/announcement.json"
mkdir -p "$(dirname "$ANNOUNCEMENT_FILE")"

echo ""
if [[ -f "$ANNOUNCEMENT_FILE" ]]; then
  echo "Current announcement:"
  jq -r '"  \(.title) [\(.level)] (expires: \(.expireAt))"' "$ANNOUNCEMENT_FILE" 2>/dev/null || echo "  (exists but unable to parse)"
  read -p "Update announcement? [y/N] " -n 1 -r
else
  echo "No active announcement."
  read -p "Create announcement? [y/N] " -n 1 -r
fi
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  edit_announcement "$ANNOUNCEMENT_FILE"
fi

# Deploy to EdgeOne Pages
echo ""
echo "========================================"
echo "Deploying website to EdgeOne Pages..."
echo "========================================"
rm -rf .edgeone
export PAGES_SOURCE=skills
cd website
edgeone pages deploy
cd ..

echo "Release ${TAG} published!"
rm -f dist.zip version.json
