#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["Pillow==12.3.0"]
# ///
# ─── How to run ───
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run from any directory:
#      uv run scripts/generate-app-icons.py
# 3. An existing Python with Pillow 12.3.0 also works:
#      python scripts/generate-app-icons.py
# ──────────────────
"""Regenerate application icons by resampling the unchanged approved source."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Final

from PIL import Image, ImageDraw, __version__

ROOT: Final = Path(__file__).resolve().parents[1]
SOURCE: Final = ROOT / "assets/branding/streamrecord-icon-source.png"
SOURCE_SHA256: Final = "ad509a00e923e6a69fbbc7c26e1a08be77e72ae6fb45ab138f05a6193ba75f84"
ICO_SIZES: Final = (16, 20, 24, 32, 40, 48, 64, 128, 256)
PNG_SIZES: Final = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 1024,
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}


def main() -> None:
    """Write deterministic derivatives and their provenance manifest."""
    if __version__ != "12.3.0":
        raise SystemExit("Use Pillow 12.3.0 for reproducible icon bytes.")
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit("Canonical source SHA-256 differs; no icons were written.")
    with Image.open(SOURCE) as original:
        if original.size != (192, 192) or original.mode != "RGBA":
            raise SystemExit("Canonical source must be 192x192 RGBA.")
        source = original.copy()
    sizes = sorted(set(PNG_SIZES.values()) | set(ICO_SIZES) | {192})
    images = {
        size: source.resize((size, size), Image.Resampling.LANCZOS)
        for size in sizes
    }
    icon_dir = ROOT / "app/frontend/src-tauri/icons"
    outputs: list[Path] = [SOURCE]
    for name, size in PNG_SIZES.items():
        output = icon_dir / name
        images[size].save(output, format="PNG", compress_level=9)
        outputs.append(output)
    public_icon = ROOT / "app/frontend/public/streamrecord-icon.png"
    images[192].save(public_icon, format="PNG", compress_level=9)
    outputs.append(public_icon)
    ico_paths = (
        icon_dir / "icon.ico",
        icon_dir / "app_icon.ico",
        ROOT / "app/frontend/src/app/favicon.ico",
    )
    for output in ico_paths:
        images[256].save(
            output,
            format="ICO",
            sizes=[(size, size) for size in ICO_SIZES],
            append_images=[images[size] for size in ICO_SIZES],
        )
        outputs.append(output)
    for name in ("icon.icns", "app_icon.icns"):
        output = icon_dir / name
        images[1024].save(
            output,
            format="ICNS",
            append_images=[images[size] for size in (32, 64, 128, 256, 512, 1024)],
        )
        outputs.append(output)

    # The two backgrounds belong only to this review sheet, never to an icon.
    sheet = Image.new("RGB", (720, 370), "white")
    drawing = ImageDraw.Draw(sheet)
    for row, background in enumerate(("#FFFFFF", "#17212E")):
        top = row * 185
        drawing.rectangle((0, top, 719, top + 184), fill=background)
        foreground = "#17212E" if row == 0 else "#FFFFFF"
        for column, size in enumerate((16, 32, 48, 128)):
            left = column * 180
            sheet.paste(images[size], (left + (180 - size) // 2, top + 24), images[size])
            drawing.text((left + 66, top + 160), f"{size} px", fill=foreground)
    contact_sheet = ROOT / "assets/branding/icon-contact-sheet.png"
    sheet.save(contact_sheet, compress_level=9)
    outputs.append(contact_sheet)

    manifest = {
        "source_sha256": SOURCE_SHA256,
        "source_size": [192, 192],
        "source_mode": "RGBA",
        "pillow_version": __version__,
        "resampling": "LANCZOS, each size directly from the canonical source",
        "preservation": "No crop, recolor, redraw, background removal or added padding",
        "upscaled_sizes": [size for size in sizes if size > 192],
        "ico_sizes": list(ICO_SIZES),
        "files": [
            {
                "path": path.relative_to(ROOT).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
            for path in outputs
        ],
    }
    manifest_path = ROOT / "assets/branding/icon-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(outputs) - 1} files; canonical source unchanged.")


if __name__ == "__main__":
    main()
