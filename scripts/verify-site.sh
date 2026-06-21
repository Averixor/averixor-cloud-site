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

for path in index.html pages workspace assets robots.txt sitemap.xml site.webmanifest CNAME _headers _redirects .nojekyll README.md LICENSE; do
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

if ! grep -q 'cloud.averixor.xyz/login' "$DIST/index.html"; then
  echo "WARN: index.html login URL check (cloud.averixor.xyz/login)" >&2
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: verify-site passed for $DIST"
else
  exit 1
fi
