#!/usr/bin/env bash
# Перевірка production-збірки перед деплоєм
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${1:-$ROOT/dist}"

if [ ! -d "$DIST" ]; then
  echo "ERROR: dist/ не знайдено. Запустіть: npm run build" >&2
  exit 1
fi

fail=0

check() {
  if [ ! -e "$DIST/$1" ]; then
    echo "MISSING: $1" >&2
    fail=1
  fi
}

for path in index.html pages privacy assets robots.txt sitemap.xml site.webmanifest CNAME _headers _redirects .nojekyll README.md LICENSE; do
  check "$path"
done

for forbidden in node_modules .git tests package.json playwright.config.js .env; do
  if find "$DIST" -name "$forbidden" 2>/dev/null | grep -q .; then
    echo "FORBIDDEN in dist: $forbidden" >&2
    fail=1
  fi
done

if ! grep -q 'averixor.xyz' "$DIST/CNAME"; then
  echo "ERROR: CNAME must contain averixor.xyz" >&2
  fail=1
fi

if ! grep -q 'https://averixor.xyz/sitemap.xml' "$DIST/robots.txt"; then
  echo "ERROR: robots.txt must reference sitemap" >&2
  fail=1
fi

if ! grep -q 'cloud.averixor.xyz/' "$DIST/index.html"; then
  echo "WARN: index.html cloud URL check (cloud.averixor.xyz/)" >&2
fi

for asset in assets/img/og-image.png assets/img/icons/apple-touch-icon.png assets/img/icons/icon-192.png assets/img/icons/icon-512.png assets/img/icons/favicon.svg; do
  check "$asset"
done

check "privacy/lost-number/index.html"



if grep -R 'cdn\.quilljs\.com' "$DIST" 2>/dev/null | grep -q .; then
  echo "ERROR: cdn.quilljs.com is forbidden (use cdn.jsdelivr.net/npm/quill@1.3.7)" >&2
  fail=1
fi

if [ -d "$DIST/workspace" ] || [ -d "$DIST/assets/js/workspace" ]; then
  echo "ERROR: workspace artifacts must not be in dist/" >&2
  fail=1
fi

if [ -f "$DIST/pages/office.html" ]; then
  echo "ERROR: pages/office.html must not be in dist/" >&2
  fail=1
fi

if grep -q '"workspace"' "$DIST/.well-known/averixor-cloud.json" 2>/dev/null; then
  echo "ERROR: .well-known must not reference workspace URL" >&2
  fail=1
fi

if ! grep -qE '^/workspace/? ' "$DIST/_redirects" 2>/dev/null; then
  echo "ERROR: _redirects must redirect /workspace to home" >&2
  fail=1
fi

if ! grep -qE '^/pages/office\.html ' "$DIST/_redirects" 2>/dev/null; then
  echo "ERROR: _redirects must redirect /pages/office.html" >&2
  fail=1
fi

if grep -R 'cloud\.averixor\.xyz/login' "$ROOT" --include='*.html' --include='*.js' 2>/dev/null | grep -vq 'verify-site.sh'; then
  echo "ERROR: source contains cloud.averixor.xyz/login (use cloud.averixor.xyz/)" >&2
  fail=1
fi

if grep -R 'cloud\.averixor\.xyz/login' "$DIST" 2>/dev/null | grep -q .; then
  echo "ERROR: cloud.averixor.xyz/login links are forbidden (use cloud.averixor.xyz/)" >&2
  fail=1
fi


if [ "$fail" -eq 0 ]; then
  echo "OK: verify-site passed for $DIST"
else
  exit 1
fi
