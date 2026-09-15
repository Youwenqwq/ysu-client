#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
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

gh auth status || { echo "Error: gh CLI not authenticated. Run 'gh auth login'."; exit 1; }

# Stable releases must come from main; prereleases may come from the current branch.
if [[ "${IS_PRERELEASE}" != "true" && "${CURRENT_BRANCH}" != "main" ]]; then
  echo "Error: Stable release must be on main, currently on '${CURRENT_BRANCH}'."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: Working directory has uncommitted changes. Commit or stash them first."
  exit 1
fi

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

if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "Error: Tag ${TAG} already exists locally."
  exit 1
fi
if git ls-remote --tags origin "refs/tags/${TAG}" | grep -q .; then
  echo "Error: Tag ${TAG} already exists on remote."
  exit 1
fi

echo "Preflight checks passed."

RELEASE_FLAGS=(--latest)
if [[ "${IS_PRERELEASE}" == "true" ]]; then
  RELEASE_FLAGS=(--prerelease)
fi

echo "Creating GitHub release ${TAG}..."
gh release create "${TAG}" \
  --target "$(git rev-parse HEAD)" \
  --title "${TAG}" \
  --generate-notes \
  "${RELEASE_FLAGS[@]}"

TMP_NOTES=$(mktemp)
trap 'rm -f "$TMP_NOTES"' EXIT

gh release view "${TAG}" --json body -q '.body' > "$TMP_NOTES" || true

if [[ -t 0 ]] && [[ -z "${CI:-}" ]]; then
  echo "Opening editor for release notes..."
  ${EDITOR:-nano} "$TMP_NOTES"
fi

gh release edit "${TAG}" --notes-file "$TMP_NOTES"

echo ""
echo "Release ${TAG} published."
echo "GitHub Actions (release.yml) 将自动构建 dist.zip、签名 APK、生成 version.json 并上传到该 Release。"
echo "关注构建进度："
echo "  gh run watch"
echo "构建完成后请确认 Release 已包含 dist.zip、app-release-${VERSION}.apk、version.json 三个产物："
echo "  gh release view ${TAG}"
