#!/usr/bin/env python3
"""Додає OG/Twitter meta та manifest на сторінки pages/*.html (ідемпотентно)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "pages"

OG_BLOCK = """  <meta property="og:type" content="website" />
  <meta property="og:locale" content="uk_UA" />
  <meta property="og:site_name" content="Averixor Cloud" />
  <meta property="og:url" content="{url}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{desc}" />
  <meta property="og:image" content="https://averixor.xyz/assets/img/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{desc}" />
  <meta name="twitter:image" content="https://averixor.xyz/assets/img/og-image.png" />
  <link rel="manifest" href="../site.webmanifest" />
  <link rel="apple-touch-icon" sizes="180x180" href="../assets/img/icons/apple-touch-icon.png" />"""


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "property=\"og:title\"" in text:
        return False
    canon = re.search(r'<link rel="canonical" href="([^"]+)"', text)
    title = re.search(r"<title>([^<]+)</title>", text)
    desc = re.search(r'<meta name="description" content="([^"]*)"', text)
    if not (canon and title and desc):
        print(f"SKIP (missing meta): {path.name}")
        return False
    block = OG_BLOCK.format(url=canon.group(1), title=title.group(1), desc=desc.group(1))
    text = text.replace(
        f'  <link rel="canonical" href="{canon.group(1)}" />',
        block + f'\n  <link rel="canonical" href="{canon.group(1)}" />',
        1,
    )
    path.write_text(text, encoding="utf-8")
    return True


def main() -> None:
    changed = sum(patch_file(p) for p in sorted(PAGES.glob("*.html")))
    print(f"inject-page-meta: updated {changed} file(s)")


if __name__ == "__main__":
    main()
