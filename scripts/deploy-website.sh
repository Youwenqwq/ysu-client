#!/usr/bin/env bash
set -euo pipefail

REPO="Youwenqwq/ysu-client"

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
    --pattern "dist.zip" --pattern "app-release.apk" --pattern "version.json" \
    --dir "$TMP_RELEASE_DIR" 2>/dev/null || true

  [[ -f "$TMP_RELEASE_DIR/dist.zip" ]] && cp "$TMP_RELEASE_DIR/dist.zip" website/public/updates/dist.zip
  [[ -f "$TMP_RELEASE_DIR/app-release.apk" ]] && cp "$TMP_RELEASE_DIR/app-release.apk" website/public/updates/app-release.apk

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

# Announcement management
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

echo ""
echo "========================================"
echo "Deploying website to EdgeOne Pages..."
echo "========================================"
rm -rf .edgeone
export PAGES_SOURCE=skills
cd website
edgeone pages deploy
cd ..

echo "Website deployed!"
