#!/usr/bin/env bash
# Збирає чистий production-артефакт для Cloudflare Pages (каталог dist/)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

rm -rf "$DIST"
mkdir -p "$DIST/docs"

copy() {
  cp -r "$1" "$DIST/$2"
}

copy "$ROOT/index.html" "index.html"
copy "$ROOT/pages" "pages"
copy "$ROOT/privacy" "privacy"
copy "$ROOT/assets" "assets"

for f in robots.txt sitemap.xml site.webmanifest CNAME _headers _redirects .nojekyll README.md LICENSE; do
  cp "$ROOT/$f" "$DIST/$f"
done

cp "$ROOT/docs/OPERATIONS.md" "$DIST/docs/OPERATIONS.md"

# Заборона dev-артефактів у production
FORBIDDEN_NAMES=(node_modules .git tests test-results playwright-report package.json package-lock.json playwright.config.js .env .env.example)
for name in "${FORBIDDEN_NAMES[@]}"; do
  if find "$DIST" -name "$name" | grep -q .; then
    echo "ERROR: заборонений файл у dist: $name" >&2
    exit 1
  fi
done

COUNT=$(find "$DIST" -type f | wc -l)
# Cloudflare Pages headers
if [ -f "$ROOT/_headers" ]; then
  cp "$ROOT/_headers" "$DIST/_headers"
else
  echo "FAIL: missing _headers" >&2
  exit 1
fi

# Public integration contract for site ↔ Nextcloud
if [ -f "$ROOT/.well-known/averixor-cloud.json" ]; then
  mkdir -p "$DIST/.well-known"
  cp "$ROOT/.well-known/averixor-cloud.json" "$DIST/.well-known/averixor-cloud.json"
else
  echo "FAIL: missing .well-known/averixor-cloud.json" >&2
  exit 1
fi
echo "OK: production build → dist/ ($COUNT файлів)"
