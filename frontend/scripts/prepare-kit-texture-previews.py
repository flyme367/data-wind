#!/usr/bin/env python3
"""Resize the large standalone textures used by the city scene previews. Requires Pillow."""

import hashlib
from io import BytesIO
import json
from pathlib import Path

from PIL import Image


FRONTEND = Path(__file__).resolve().parents[1]
ASSETS = FRONTEND / "public/kits/assets"
SOURCE_PREFIXES = ("5edeaac15d", "75644099dc", "e96f01e6b7", "f69097a3d4")

previews = {}
for prefix in SOURCE_PREFIXES:
    (source,) = ASSETS.glob(f"{prefix}*.webp")
    with Image.open(source) as image:
        image.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
        encoded = BytesIO()
        image.save(encoded, "WEBP", lossless=True, method=4)
    contents = encoded.getvalue()
    filename = hashlib.sha256(contents).hexdigest() + ".webp"
    (ASSETS / filename).write_bytes(contents)
    previews[source.name] = f"/kits/assets/{filename}"

(FRONTEND / "src/data/kitTexturePreviews.json").write_text(json.dumps(previews, indent=2) + "\n")
