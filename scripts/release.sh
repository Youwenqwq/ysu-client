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
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ -t 0 ]] && [[ -z "${CI:-}" ]]; then
  echo "Detected release channel: ${RELEASE_CHANNEL}"
  echo "Version: ${VERSION}"
  echo "Branch: ${CURRENT_BRANCH}"
  if [[ "${IS_PRERELEASE}" == "true" && "${CURRENT_BRANCH}" != "main" ]]; then
    echo "This will publish a prerelease from a non-main branch and deploy website updates to EdgeOne Pages."
  fi
  read -p "Continue? [y/N] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Release cancelled."
    exit 0
  fi
else
  echo "Detected release channel: ${RELEASE_CHANNEL} (${VERSION}) on ${CURRENT_BRANCH}"
fi

# Preflight checks
echo "Running preflight checks..."

# Ensure gh is authenticated
gh auth status || { echo "Error: gh CLI not authenticated. Run 'gh auth login'."; exit 1; }

# Stable releases must come from main; prereleases may come from the current branch.
if [[ "${IS_PRERELEASE}" != "true" && "${CURRENT_BRANCH}" != "main" ]]; then
  echo "Error: Stable release must be on main, currently on '${CURRENT_BRANCH}'."
  exit 1
fi

# Ensure working directory is clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: Working directory has uncommitted changes. Commit or stash them first."
  exit 1
fi

# Ensure current commit is pushed before publishing a release.
LOCAL_COMMIT=$(git rev-parse HEAD)
if [[ "${IS_PRERELEASE}" == "true" ]]; then
  UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
  if [[ -z "${UPSTREAM}" ]]; then
    echo "Error: Prerelease branch '${CURRENT_BRANCH}' has no upstream. Push it first:"
    echo "  git push -u origin ${CURRENT_BRANCH}"
    exit 1
  fi
  PUSH_HINT="git push"
else
  UPSTREAM="origin/main"
  PUSH_HINT="git push origin main"
fi
REMOTE_COMMIT=$(git rev-parse "${UPSTREAM}" 2>/dev/null || echo "")
if [[ "${LOCAL_COMMIT}" != "${REMOTE_COMMIT}" ]]; then
  echo "Error: Current commit is not pushed to ${UPSTREAM}. Push first: ${PUSH_HINT}"
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
  [[ -n "${TMP_STABLE_RELEASE_DIR:-}" ]] && rm -rf "$TMP_STABLE_RELEASE_DIR"
  [[ -n "${APK_ASSET_PATH:-}" ]] && rm -f "$APK_ASSET_PATH"
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

# Read Android versionName from build.gradle and compute versionCode.
# Version code layout: major*1_000_000 + minor*10_000 + patch*100 + stageCode.
# stageCode: alpha.N=N (1..19), beta.N=20+N (21..49), rc.N=50+N (51..98), stable=99.
read -r APK_VERSION_NAME APK_VERSION_CODE < <(node - <<'NODE'
const { readFileSync } = require('node:fs');
const text = readFileSync('android/app/build.gradle', 'utf8');
const versionName = text.match(/versionName\s+"([^"]+)"/)?.[1];
if (!versionName) {
  console.error('Error: Unable to find Android versionName.');
  process.exit(1);
}
const match = versionName.match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/);
if (!match) {
  console.error(`Error: Invalid Android versionName '${versionName}'.`);
  process.exit(1);
}
const [, majorText, minorText, patchText, stage, numberText] = match;
const major = Number(majorText);
const minor = Number(minorText);
const patch = Number(patchText);
let stageCode = 99;
if (stage) {
  const n = Number(numberText);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`Error: Invalid prerelease number in Android versionName '${versionName}'.`);
    process.exit(1);
  }
  if (stage === 'alpha') {
    if (n > 19) {
      console.error(`Error: alpha prerelease number must be 1..19: ${versionName}`);
      process.exit(1);
    }
    stageCode = n;
  } else if (stage === 'beta') {
    if (n > 29) {
      console.error(`Error: beta prerelease number must be 1..29: ${versionName}`);
      process.exit(1);
    }
    stageCode = 20 + n;
  } else if (stage === 'rc') {
    if (n > 48) {
      console.error(`Error: rc prerelease number must be 1..48: ${versionName}`);
      process.exit(1);
    }
    stageCode = 50 + n;
  }
}
const versionCode = major * 1_000_000 + minor * 10_000 + patch * 100 + stageCode;
console.log(`${versionName} ${versionCode}`);
NODE
)

APK_ASSET_NAME="app-release-${VERSION}.apk"
APK_ASSET_PATH="${APK_ASSET_NAME}"
cp "${APK_PATH}" "${APK_ASSET_PATH}"

RELEASE_FLAGS=(--latest)
if [[ "${IS_PRERELEASE}" == "true" ]]; then
  RELEASE_FLAGS=(--prerelease)
fi

echo "Creating GitHub release ${TAG}..."
gh release create "${TAG}" dist.zip "${APK_ASSET_PATH}" \
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
elif [[ "${IS_PRERELEASE}" == "true" ]]; then
  echo "Local stable version.json missing; fetching latest stable OTA files from GitHub..."
  TMP_STABLE_RELEASE_DIR=$(mktemp -d)
  LATEST_STABLE_TAG=$(gh api "repos/${REPO}/releases/latest" -q '.tag_name' 2>/dev/null || true)
  if [[ -n "${LATEST_STABLE_TAG:-}" ]]; then
    gh release download "$LATEST_STABLE_TAG" --repo "$REPO" \
      --pattern "dist.zip" --pattern "app-release*.apk" --pattern "version.json" \
      --dir "$TMP_STABLE_RELEASE_DIR" 2>/dev/null || true
  fi
  if [[ -f "$TMP_STABLE_RELEASE_DIR/version.json" ]]; then
    cp "$TMP_STABLE_RELEASE_DIR/version.json" "$TMP_VERSION_BASE"
    mkdir -p website/public/updates
    [[ -f "$TMP_STABLE_RELEASE_DIR/dist.zip" ]] && cp "$TMP_STABLE_RELEASE_DIR/dist.zip" website/public/updates/dist.zip
    STABLE_APK=$(find "$TMP_STABLE_RELEASE_DIR" -maxdepth 1 -name 'app-release*.apk' -print -quit)
    [[ -n "${STABLE_APK:-}" ]] && cp "$STABLE_APK" website/public/updates/app-release.apk
  else
    echo "Warning: stable version.json unavailable; prerelease manifest will not include stable metadata."
    echo '{}' > "$TMP_VERSION_BASE"
  fi
else
  echo '{}' > "$TMP_VERSION_BASE"
fi

APK_DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${APK_ASSET_NAME}"
PRERELEASE_DIST_NAME="dist-${VERSION}.zip"
PRERELEASE_DIST_URL="${OFFICIAL_UPDATES_BASE}${PRERELEASE_DIST_NAME}"
PRERELEASE_APK_NAME="app-release-${VERSION}.apk"
PRERELEASE_APK_URL="${OFFICIAL_UPDATES_BASE}${PRERELEASE_APK_NAME}"
APK_IS_PRERELEASE="false"
if [[ "${APK_VERSION_NAME}" == *-* ]]; then
  APK_IS_PRERELEASE="true"
fi

echo "Generating version.json with release notes..."
if [[ "${IS_PRERELEASE}" == "true" ]]; then
  if [[ "${APK_IS_PRERELEASE}" == "true" ]]; then
    jq \
      --arg webVersion "$VERSION" \
      --arg webDownloadUrl "$PRERELEASE_DIST_URL" \
      --arg apkDownloadUrl "$PRERELEASE_APK_URL" \
      --arg body "$BODY" \
      --argjson apkVersionCode "$APK_VERSION_CODE" \
      '.channels = ((.channels // {}) + {
        prerelease: {
          webVersion: $webVersion,
          webDownloadUrl: $webDownloadUrl,
          apkVersionCode: $apkVersionCode,
          apkDownloadUrl: $apkDownloadUrl,
          body: $body
        }
      })' \
      "$TMP_VERSION_BASE" > version.json
  else
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
  fi
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
  prerelease: .prerelease,
  date: (.published_at | fromdateiso8601 + 28800 | strftime("%Y-%m-%d")),
  body: .body
})' > website/src/data/changelog.json

# Copy OTA files to website dist
mkdir -p website/public/updates
if [[ "${IS_PRERELEASE}" == "true" ]]; then
  cp dist.zip "website/public/updates/${PRERELEASE_DIST_NAME}"
  if [[ "${APK_IS_PRERELEASE}" == "true" ]]; then
    cp "${APK_PATH}" "website/public/updates/${PRERELEASE_APK_NAME}"
  fi
  cp version.json website/public/updates/
else
  cp dist.zip website/public/updates/
  cp "${APK_PATH}" website/public/updates/app-release.apk
  cp version.json website/public/updates/
fi

# Deploy to EdgeOne Pages
echo ""
echo "========================================"
echo "Deploying website to EdgeOne Pages..."
echo "========================================"
rm -rf .edgeone
export PAGES_SOURCE=skills
cd website
edgeone makers deploy
cd ..

echo "Release ${TAG} published!"
rm -f dist.zip version.json
