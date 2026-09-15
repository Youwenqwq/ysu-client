#!/usr/bin/env bash
set -euo pipefail

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
