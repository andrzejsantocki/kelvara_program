#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB="$ROOT/subapps/kamino-monitor/web"
PUBLISH="${PUBLISH_DIR:-/tmp/kelvara-monitor-ui-publish}"
REPO="https://github.com/andrzejsantocki/kelvara-monitor-ui.git"

if [[ ! -d "$PUBLISH/.git" ]]; then
  rm -rf "$PUBLISH"
  git clone "$REPO" "$PUBLISH"
fi

git -C "$PUBLISH" fetch origin -q
git -C "$PUBLISH" reset --hard origin/main -q
rm -rf "$PUBLISH/assets" "$PUBLISH/vendor"
mkdir -p "$PUBLISH/assets" "$PUBLISH/vendor"
cp "$WEB/index.html" "$WEB/app.js" "$WEB/animal-identicon.js" "$WEB/styles.css" "$PUBLISH/"
cp -R "$WEB/assets/." "$PUBLISH/assets/"
cp "$ROOT/node_modules/@solana/web3.js/lib/index.iife.min.js" "$PUBLISH/vendor/solana-web3.min.js"
printf 'app.kelvara.xyz\n' > "$PUBLISH/CNAME"
: > "$PUBLISH/.nojekyll"

if git -C "$PUBLISH" diff --quiet && git -C "$PUBLISH" diff --cached --quiet; then
  echo "No frontend changes to deploy."
  exit 0
fi

git -C "$PUBLISH" add -A
git -C "$PUBLISH" commit -m "deploy: publish Kelvara monitor UI $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git -C "$PUBLISH" push origin main

echo "Published: https://app.kelvara.xyz"
