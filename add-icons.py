#!/usr/bin/env python3
"""
Run this from ~/Desktop/Projects/Vercel_Hub/doug-kim-dfk after copying the
icons/ folder into that repo root.

Inserts <link rel="apple-touch-icon" href="/icons/icon-<slug>.png"> into each
page's <head>, right before </head>. Idempotent — running it twice won't
duplicate tags (it skips any file that already has an apple-touch-icon link).
"""
import re
from pathlib import Path

MAPPING = {
    "tracker.html": "tracker",
    "doctrine.html": "doctrine",
    "manifesto.html": "manifesto",
    "caught.html": "caught",
    "system.html": "system",
    "underachiever.html": "underachiever",
    "brain-rebuild.html": "brain-rebuild",
    "daily-list.html": "daily-list",
    "writing-practice.html": "writing-practice",
    "writing-voice.html": "writing-voice",
    "intention.html": "intention",
    "cameras-down.html": "cameras-down",
    "craft-example-cameras-down.html": "craft-example-cameras-down",
    "grid.html": "grid",
    "index.html": "index",
    # cliff.html and dfk_index.html intentionally excluded — already have
    # custom black icons, not touched by this batch
}

root = Path(".")
changed, skipped, missing = [], [], []

for filename, slug in MAPPING.items():
    path = root / filename
    if not path.exists():
        missing.append(filename)
        continue
    text = path.read_text(encoding="utf-8")
    if "apple-touch-icon" in text:
        skipped.append(filename)
        continue
    tag = f'  <link rel="apple-touch-icon" href="/icons/icon-{slug}.png">\n'
    if "</head>" not in text:
        missing.append(f"{filename} (no </head> found)")
        continue
    text = text.replace("</head>", tag + "</head>", 1)
    path.write_text(text, encoding="utf-8")
    changed.append(filename)

print(f"Updated:  {len(changed)} -> {changed}")
print(f"Skipped (already had an icon tag): {len(skipped)} -> {skipped}")
print(f"Missing/problem files: {len(missing)} -> {missing}")
