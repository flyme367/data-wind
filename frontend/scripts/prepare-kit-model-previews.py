#!/usr/bin/env python3
"""Prepare smaller GLB previews from the original kit archives.

Usage: python3 frontend/scripts/prepare-kit-model-previews.py --gltfpack /path/to/gltfpack
Requires gltfpack 1.3 and Pillow. See docs/kit-sync.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "frontend/public/kits/assets"
OUTPUT = ROOT / "frontend/src/data/kitModelPreviews.json"
# Enabled city scene models with readable glTF payloads that exceed the editor import budget.
SOURCE_PREFIXES = ("01e9bc7d", "2aa89511", "31cd58a4", "39d3bf7c", "3b40a83c", "bfba3ead", "fd988abb")


def glb_parts(path: Path):
    contents = path.read_bytes()
    magic, version, size, length, chunk = struct.unpack_from("<4sIII4s", contents)
    expected = b"obj3" if path.suffix == ".obj3" else b"glTF"
    if magic != expected or version != 2 or size != len(contents) or chunk != b"JSON":
        raise ValueError(f"Invalid glTF 2.0 payload: {path.name}")
    end = 20 + length
    document = json.loads(contents[20:end])
    length, chunk = struct.unpack_from("<I4s", contents, end)
    if chunk != b"BIN\x00" or end + 8 + length != len(contents):
        raise ValueError(f"Expected one embedded buffer in {path.name}")
    return document, memoryview(contents)[end + 8:]


def triangles(document) -> int:
    accessors = document["accessors"]
    return sum(accessors[p.get("indices", p["attributes"]["POSITION"])]["count"] // 3
               for mesh in document["meshes"] for p in mesh["primitives"] if p.get("mode", 4) == 4)


def resize_textures(packed: Path) -> bytes:
    document, source = glb_parts(packed)
    block = bytearray()
    images = {image["bufferView"]: image for image in document.get("images", [])}
    for index, view in enumerate(document["bufferViews"]):
        start = view.get("byteOffset", 0)
        payload = source[start:start + view["byteLength"]]
        if index in images:
            with Image.open(BytesIO(payload)) as texture:
                if max(texture.size) > 1024:
                    texture.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                    resized = BytesIO()
                    image_format = "JPEG" if images[index]["mimeType"] == "image/jpeg" else "PNG"
                    texture.save(resized, format=image_format, quality=90)
                    payload = resized.getvalue()
        block.extend(b"\x00" * ((-len(block)) % 4))
        view["byteOffset"], view["byteLength"] = len(block), len(payload)
        block.extend(payload)
    document["buffers"][0]["byteLength"] = len(block)
    block.extend(b"\x00" * ((-len(block)) % 4))
    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    return (struct.pack("<4sIII4s", b"glTF", 2, 28 + len(encoded) + len(block), len(encoded), b"JSON")
            + encoded + struct.pack("<I4s", len(block), b"BIN\x00") + block)


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--gltfpack", default="gltfpack")
    tool = args.parse_args().gltfpack
    with tempfile.TemporaryDirectory(prefix="data-wind-kit-preview-") as temp:
        scratch = Path(temp)
        preview = {}
        for prefix in SOURCE_PREFIXES:
            matches = [p for p in ASSETS.glob(f"{prefix}*") if p.suffix in {".glb", ".obj3"}]
            if len(matches) != 1:
                raise ValueError(f"Expected a single source matching {prefix}")
            source = matches[0]
            document, _ = glb_parts(source)
            faces = triangles(document)
            target = min(1.0, 15_500 / faces)
            packed = scratch / "packed.glb"
            source_glb = source
            if source.suffix == ".obj3":
                # This archive uses a custom magic with plain glTF JSON and binary chunks.
                source_glb = scratch / "source.glb"
                with source.open("rb") as original, source_glb.open("wb") as glb:
                    original.seek(4)
                    glb.write(b"glTF")
                    shutil.copyfileobj(original, glb)
            subprocess.run([tool, "-i", str(source_glb), "-o", str(packed), "-noq", "-kn", "-km",
                            "-si", f"{target:.8f}", "-sa", "-sp"], check=True)
            compact = resize_textures(packed)
            if len(compact) > 20_000_000:
                raise ValueError(f"Preview still exceeds the importer size limit: {source.name}")
            digest = hashlib.sha256(compact).hexdigest()
            filename = f"{digest}.glb"
            generated = ASSETS / filename
            if not generated.exists():
                generated.write_bytes(compact)
            preview[source.name] = f"/kits/assets/{filename}"
            print(f"{source.name[:8]}: {faces:,} source triangles → {len(compact):,} preview bytes", flush=True)
    OUTPUT.write_text(json.dumps(preview, indent=2) + "\n")


if __name__ == "__main__":
    main()
