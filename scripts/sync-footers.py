#!/usr/bin/env python3
"""Синхронізує єдиний footer на всіх сторінках pages/*.html."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "pages"
FOOTER = (Path(__file__).parent / "partials" / "footer-pages.html").read_text(encoding="utf-8")

PATTERN = re.compile(
    r"  <footer class=\"site-footer footer-mega\">.*?</footer>\n",
    re.DOTALL,
)


def main() -> None:
    for path in sorted(PAGES.glob("*.html")):
        text = path.read_text(encoding="utf-8")
        if not PATTERN.search(text):
            print(f"SKIP (no footer): {path.name}")
            continue
        text = PATTERN.sub(FOOTER, text, count=1)
        path.write_text(text, encoding="utf-8")
        print(f"synced footer: {path.name}")


if __name__ == "__main__":
    main()
