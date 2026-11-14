#!/usr/bin/env python3
"""Import the public Shanhaibi kit packages as data, without executing package code.

The source catalog is obtained through the reference site's ordinary signed-in UI.
Only public static.shanhaibi.com asset URLs from that catalog are downloaded here.
Archives are cached outside the repository. Existing valid downloads are reused.
"""

from __future__ import annotations

import argparse
from collections import Counter
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import threading
import time
import urllib.parse
from zipfile import BadZipFile, ZipFile


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "frontend/public/kits"
CACHE = Path("/tmp/data-wind-kit-downloads")
FAMILY_IDS = [
    "free", "china-red", "general", "utility-tunnel", "smart-park", "star-blue",
    "glazed-gold", "violet", "spring-blue", "city-ioc", "water", "highway", "light",
]
MAX_DOWNLOAD = 750 * 1024 * 1024
LOCK = threading.Lock()
REPORT: dict = {"failures": [], "skipped": [], "packages": [], "downloadBytes": 0}
# 静态位图一律落盘为 webp（项目图片规范：q60 有损/无损取小者，见 lib-webp.mjs）。
RASTER_SUFFIXES = {".png", ".jpg", ".jpeg"}


def min_webp(data: bytes) -> bytes:
    """Encode static raster bytes with the same recipe as frontend/scripts/lib-webp.mjs."""
    with tempfile.TemporaryDirectory() as scratch:
        # cwebp sniffs the format by magic bytes, so the suffix is irrelevant.
        source = Path(scratch) / "source"
        lossy = Path(scratch) / "lossy.webp"
        lossless = Path(scratch) / "lossless.webp"
        source.write_bytes(data)
        subprocess.run(["cwebp", "-q", "60", "-m", "6", "-quiet", str(source), "-o", str(lossy)],
                       check=True, capture_output=True)
        best = lossy.read_bytes()
        if subprocess.run(["cwebp", "-q", "60", "-m", "6", "-lossless", "-quiet",
                           str(source), "-o", str(lossless)], capture_output=True).returncode == 0:
            smaller = lossless.read_bytes()
            if len(smaller) < len(best):
                best = smaller
        return best


class HttpRangeFile(io.RawIOBase):
    """Read a public ZIP when a full response is unavailable."""

    def __init__(self, url: str):
        super().__init__()
        self.url = url
        self.position = 0
        self.cache_key = hashlib.sha256(url.encode()).hexdigest()
        headers = subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--head",
                                  "--connect-timeout", "15", "--max-time", "30", url],
                                 check=True, capture_output=True).stdout.decode()
        lengths = re.findall(r"(?im)^Content-Length:\s*(\d+)\s*$", headers)
        if not lengths or not re.search(r"(?im)^Accept-Ranges:\s*bytes", headers):
            raise ValueError("Large source package does not expose safe HTTP byte ranges")
        self.size = int(lengths[-1])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if self.position < 0:
            raise ValueError("Negative ZIP offset")
        return self.position

    def read(self, size=-1):
        if size == 0 or self.position >= self.size:
            return b""
        size = min(self.size - self.position, size if size >= 0 else self.size - self.position)
        start, end = self.position, self.position + size - 1
        target = CACHE / f"{self.cache_key}-{start}-{end}.range"
        if not target.exists():
            temporary = target.with_suffix(f".{threading.get_ident()}.part")
            subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                            "--connect-timeout", "15", "--max-time", "120", "--range", f"{start}-{end}",
                            "--max-filesize", str(size), "--output", str(temporary), self.url],
                           check=True, capture_output=True)
            if temporary.stat().st_size != size:
                temporary.unlink(missing_ok=True)
                raise ValueError("Server did not honor the exact requested ZIP byte range")
            temporary.replace(target)
            with LOCK:
                REPORT["downloadBytes"] += size
        result = target.read_bytes()
        self.position += len(result)
        return result


def dump(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def download(url: str, archive: bool = False) -> Path:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "static.shanhaibi.com":
        raise ValueError(f"Not a public reference asset URL: {url}")
    suffix = Path(parsed.path).suffix.lower()
    target = CACHE / (hashlib.sha256(url.encode()).hexdigest() + suffix)
    if target.exists() and target.stat().st_size:
        if not archive:
            return target
        try:
            with ZipFile(target) as zip_file:
                if zip_file.namelist():
                    return target
        except BadZipFile:
            target.unlink()
    last_error = None
    for attempt in range(3):
        temporary = target.with_suffix(target.suffix + f".{threading.get_ident()}.part")
        try:
            # macOS's system curl uses the OS trust store. The bundled Python
            # interpreter may not have a CA bundle; never bypass TLS validation.
            subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                            "--connect-timeout", "15", "--max-time", "120",
                            "--max-filesize", str(MAX_DOWNLOAD),
                            "--output", str(temporary), url], check=True, capture_output=True)
            written = temporary.stat().st_size
            temporary.replace(target)
            if archive:
                with ZipFile(target) as zip_file:
                    if not zip_file.namelist():
                        raise BadZipFile("Empty template archive")
            with LOCK:
                REPORT["downloadBytes"] += written
            return target
        except Exception as error:
            last_error = error
            temporary.unlink(missing_ok=True)
            if attempt < 2:
                time.sleep((attempt + 1) * 0.6)
    raise RuntimeError(f"Download failed for {url}: {last_error}")


def extension(data: bytes, name: str) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if b"<svg" in data[:2048]:
        return ".svg"
    if data[:4] == b"wOFF":
        return ".woff"
    if data[:4] == b"wOF2":
        return ".woff2"
    if data[:4] == b"OTTO":
        return ".otf"
    if data[:4] == b"\x00\x01\x00\x00":
        return ".ttf"
    if data[:4] == b"glTF":
        return ".glb"
    if data.startswith(b"\x1aE\xdf\xa3"):
        return ".webm" if b"webm" in data[:256] else ".mkv"
    if data.startswith(b"OggS"):
        return ".ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return ".wav"
    if data.startswith(b"%PDF"):
        return ".pdf"
    if data[4:8] == b"ftyp":
        brand = data[8:32]
        if b"avif" in brand or b"avis" in brand:
            return ".avif"
        if b"heic" in brand or b"heix" in brand:
            return ".heic"
        return ".mp4"
    if data.startswith(b"ID3"):
        return ".mp3"
    suffix = Path(name).suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix) else ".bin"


def store_asset(data: bytes, name: str, folder: str = "assets") -> str:
    # 哈希取原始内容，静态位图统一转 webp；同源内容重复导入仍精确去重。
    digest = hashlib.sha256(data).hexdigest()
    suffix = extension(data, name)
    if suffix in RASTER_SUFFIXES:
        data = min_webp(data)
        suffix = ".webp"
    filename = digest + suffix
    target = PUBLIC / folder / filename
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        # Atomic replacement makes deduplication safe across import threads.
        temporary = target.with_name(f".{filename}.{threading.get_ident()}.part")
        temporary.write_bytes(data)
        temporary.replace(target)
    return f"/kits/{folder}/{filename}"


def store_zip_asset(zip_file: ZipFile, member) -> str:
    folder = PUBLIC / "assets"
    folder.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with zip_file.open(member) as source, tempfile.NamedTemporaryFile(dir=folder, delete=False) as output:
        temporary = Path(output.name)
        try:
            chunk = source.read(1024 * 1024)
            suffix = extension(chunk[:2048], member.filename)
            while chunk:
                digest.update(chunk)
                output.write(chunk)
                chunk = source.read(1024 * 1024)
            output.close()
            target = folder / (digest.hexdigest() + suffix)
            if suffix in RASTER_SUFFIXES:
                # 静态位图转 webp 后哈希仍取原始内容，命名与 store_asset 一致。
                converted = folder / f".{digest.hexdigest()}.{threading.get_ident()}.part"
                converted.write_bytes(min_webp(temporary.read_bytes()))
                converted.replace(target.with_suffix(".webp"))
                temporary.unlink(missing_ok=True)
                return f"/kits/assets/{target.with_suffix('.webp').name}"
            if not target.exists():
                temporary.chmod(0o644)
                temporary.replace(target)
            return f"/kits/assets/{target.name}"
        finally:
            temporary.unlink(missing_ok=True)


def safe_name(name: str) -> str:
    # ZipFile.read rather than extract prevents filesystem traversal. Validate
    # even names only used as dictionary keys, so the input contract is explicit.
    if "\\" in name or "\x00" in name:
        raise ValueError(f"Unsafe archive path: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe archive path: {name!r}")
    return str(path)


def archive_aliases(info) -> list[str]:
    """Old Windows ZIPs use GBK filenames without the UTF-8 flag."""
    aliases = [safe_name(info.filename)]
    if not info.flag_bits & 0x800:
        try:
            original = info.filename.encode("cp437")
            for encoding in ("utf-8", "gb18030"):
                try:
                    decoded = safe_name(original.decode(encoding))
                    if decoded not in aliases:
                        aliases.append(decoded)
                except (UnicodeError, ValueError):
                    pass
        except UnicodeError:
            pass
    return aliases


def model_directory(value) -> str:
    if not isinstance(value, dict) or value.get("__opt_type") != "folder":
        return ""
    path = value.get("relativeDir")
    if isinstance(path, str):
        path = path.replace("\\", "/")
        if path.startswith("/resources/"):
            path = path[1:]
        if path.startswith("resources/library-model/"):
            return path.rstrip("/")
    return ""


def referenced_model_directories(value) -> set[str]:
    paths = set()
    if isinstance(value, dict):
        path = model_directory(value)
        if path:
            paths.add(path)
        for child in value.values():
            paths.update(referenced_model_directories(child))
    elif isinstance(value, list):
        for child in value:
            paths.update(referenced_model_directories(child))
    return paths


def bind_model_directories(value, assets: dict[str, str], directories: set[str]) -> None:
    members = {}
    for directory in directories:
        prefix = directory + "/"
        files = {path[len(prefix):]: local for path, local in assets.items() if path.startswith(prefix)}
        if "index.json" in files and "meta.json" in files:
            members[directory] = dict(sorted(files.items()))

    def bind(item):
        if isinstance(item, dict):
            files = members.get(model_directory(item))
            if files:
                item["__kitDirectoryFiles"] = files
            for key, child in item.items():
                if key != "__kitDirectoryFiles":
                    bind(child)
        elif isinstance(item, list):
            for child in item:
                bind(child)
    bind(value)


def rewrite(value, assets: dict[str, str]):
    if isinstance(value, dict):
        return {key: rewrite(item, assets) for key, item in value.items()}
    if isinstance(value, list):
        return [rewrite(item, assets) for item in value]
    if isinstance(value, str):
        path = value.replace("\\", "/")
        path = path[1:] if path.startswith("/resources/") else path
        if path in assets:
            return assets[path]
    return value


def import_entry(entry: dict) -> dict:
    entry_id = entry["id"]
    try:
        if not entry["thumbnail"].startswith("/kits/"):
            thumbnail = download(entry["thumbnail"])
            entry["thumbnail"] = store_asset(thumbnail.read_bytes(), thumbnail.name, "thumbs")
        try:
            package = download(entry["sourceUrl"], archive=True)
            zip_file = ZipFile(package)
            package_size = package.stat().st_size
        except RuntimeError as error:
            if "exit status 63" not in str(error):
                raise
            remote = HttpRangeFile(entry["sourceUrl"])
            zip_file = ZipFile(remote)
            package_size = remote.size
        with zip_file:
            names = {safe_name(item.filename): item for item in zip_file.infolist() if not item.is_dir()}
            main_name = "index.json" if "index.json" in names else "main.json"
            if main_name not in names:
                raise ValueError("Template archive has neither index.json nor main.json")
            if names[main_name].file_size > 20 * 1024 * 1024:
                raise ValueError("Template JSON exceeds 20 MiB")
            template = json.loads(zip_file.read(names[main_name]))
            scripts = {name: zip_file.read(info).decode("utf-8-sig") for name, info in names.items()
                       if name.startswith("code/") and Path(name).suffix.lower() == ".js"}
            if scripts:
                template["referenceScripts"] = scripts
            assets = {}
            resource_count = 0
            for name, info in names.items():
                if not name.startswith("resources/"):
                    continue
                # Raw JS/HTML may be present in old third-party templates. Keep
                # their data in the source JSON, but do not publish executables.
                if Path(name).suffix.lower() in {".js", ".cjs", ".mjs", ".html", ".exe", ".sh"}:
                    with LOCK:
                        REPORT["skipped"].append({"entry": entry_id, "path": name, "bytes": info.file_size,
                                                  "reason": "Executable content is not an image/media asset"})
                    continue
                local_path = store_zip_asset(zip_file, info)
                for alias in archive_aliases(info):
                    assets[alias] = local_path
                resource_count += 1
            template = rewrite(template, assets)
            bind_model_directories(template, assets, referenced_model_directories(template))
            dump(PUBLIC / "templates" / f"{entry_id}.json", template)
            with LOCK:
                REPORT["packages"].append({"id": entry_id, "bytes": package_size,
                                           "resources": resource_count, "rootType": template.get("type")})
        return entry
    except Exception as error:
        with LOCK:
            REPORT["failures"].append({"id": entry_id, "label": entry["label"], "url": entry["sourceUrl"],
                                        "error": str(error)})
        return entry


def repair_mime() -> None:
    """Upgrade previously imported opaque extensions without another download."""
    replacements = {}
    for path in (PUBLIC / "assets").glob("*"):
        if not path.is_file() or path.name.startswith("."):
            continue
        with path.open("rb") as source:
            actual = extension(source.read(2048), path.name)
        if actual != path.suffix:
            target = path.with_suffix(actual)
            replacements[f"/kits/assets/{path.name}"] = f"/kits/assets/{target.name}"
            path.replace(target)
    for template in (PUBLIC / "templates").glob("*.json"):
        data = json.loads(template.read_text())
        patched = rewrite(data, replacements)
        if patched != data:
            dump(template, patched)
    print(f"Repaired MIME extensions for {len(replacements)} assets", flush=True)


def repair_references() -> None:
    """Repair old filename encodings and legacy image suffixes from cached packages."""
    catalog = json.loads((ROOT / "frontend/src/data/referenceKits.json").read_text())
    repaired = 0
    for family in catalog["families"]:
        for entry in family["entries"]:
            template_path = PUBLIC / "templates" / f"{entry['id']}.json"
            if not template_path.exists():
                continue
            template = json.loads(template_path.read_text())
            paths = set()
            def find_paths(value):
                if isinstance(value, str):
                    value = value.replace("\\", "/")
                    if value.startswith("resources/"):
                        paths.add(value)
                elif isinstance(value, list):
                    for item in value:
                        find_paths(item)
                elif isinstance(value, dict):
                    for item in value.values():
                        find_paths(item)
            find_paths(template)
            if not paths:
                continue
            suffix = Path(urllib.parse.urlparse(entry["sourceUrl"]).path).suffix
            package = CACHE / (hashlib.sha256(entry["sourceUrl"].encode()).hexdigest() + suffix)
            if not package.exists():
                continue
            replacements = {}
            with ZipFile(package) as zip_file:
                aliases = {}
                for info in zip_file.infolist():
                    if info.is_dir() or Path(info.filename).suffix.lower() in {".js", ".cjs", ".mjs", ".html", ".exe", ".sh"}:
                        continue
                    for alias in archive_aliases(info):
                        aliases[alias] = info
                for path in paths:
                    info = aliases.get(path)
                    if info is None and path.endswith(".p.di"):
                        info = aliases.get(path[:-5] + ".di")
                    if info is not None:
                        replacements[path] = store_zip_asset(zip_file, info)
            if replacements:
                dump(template_path, rewrite(template, replacements))
                repaired += len(replacements)
    print(f"Repaired {repaired} legacy filename references", flush=True)
    verify_corpus()


def repair_model_directories() -> None:
    catalog = json.loads((ROOT / "frontend/src/data/referenceKits.json").read_text())
    entries = {entry["id"]: entry for family in catalog["families"] for entry in family["entries"]}
    report = json.loads((PUBLIC / "sync-report.json").read_text())
    affected = {record["entry"] for record in report["unresolvedSourceReferences"]
                if record["path"].startswith("resources/library-model/")}
    CACHE.mkdir(parents=True, exist_ok=True)
    for entry_id in sorted(affected):
        file = PUBLIC / "templates" / f"{entry_id}.json"
        template = json.loads(file.read_text())
        directories = referenced_model_directories(template)
        if not directories:
            continue
        url = entries[entry_id]["sourceUrl"]
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "static.shanhaibi.com":
            raise ValueError(f"Invalid source archive for {entry_id}")
        package = CACHE / (hashlib.sha256(url.encode()).hexdigest() + Path(parsed.path).suffix.lower())
        prefixes = tuple(path + "/" for path in directories)
        assets = {}
        with ZipFile(package if package.is_file() else HttpRangeFile(url)) as zip_file:
            for info in zip_file.infolist():
                if info.is_dir() or Path(info.filename).suffix.lower() in {".js", ".cjs", ".mjs", ".html", ".exe", ".sh"}:
                    continue
                aliases = [path for path in archive_aliases(info) if path.startswith(prefixes)]
                if aliases:
                    local_path = store_zip_asset(zip_file, info)
                    assets.update(dict.fromkeys(aliases, local_path))
        bind_model_directories(template, assets, directories)
        dump(file, template)
    verify_corpus()


def verify_corpus() -> None:
    catalog = json.loads((ROOT / "frontend/src/data/referenceKits.json").read_text())
    report_path = PUBLIC / "sync-report.json"
    report = json.loads(report_path.read_text())
    families = catalog["families"]
    widget_types = Counter()
    unresolved = set()
    referenced = Counter()
    options = 0

    def collect(value, entry_id, scripts):
        if isinstance(value, list):
            for item in value:
                collect(item, entry_id, scripts)
        elif isinstance(value, dict):
            directory = value.get("__kitDirectoryFiles")
            if directory is not None:
                if not model_directory(value) or not isinstance(directory, dict):
                    raise ValueError(f"Invalid model directory in {entry_id}")
                if not {"index.json", "meta.json"}.issubset(directory):
                    raise ValueError(f"Incomplete model directory in {entry_id}")
                if any(safe_name(name) != name or not isinstance(local, str) or not local.startswith("/kits/assets/")
                       for name, local in directory.items()):
                    raise ValueError(f"Invalid model directory member in {entry_id}")
            for key, item in value.items():
                if key != "referenceScripts" and not (key == "relativeDir" and directory is not None):
                    collect(item, entry_id, scripts)
        elif isinstance(value, str):
            path = value.replace("\\", "/")
            if path.startswith("/kits/"):
                if not (PUBLIC / safe_name(path[len("/kits/"):])).is_file():
                    raise ValueError(f"Missing local asset in {entry_id}: {path}")
                referenced[path] += 1
            elif path.startswith("resources/") or path.startswith("code/") and path not in scripts:
                unresolved.add((entry_id, path))

    def visit(widget):
        nonlocal options
        widget_types[widget["type"]] += 1
        options += len(widget.get("options", {}))
        for child in widget.get("widgets", []):
            visit(child)

    entries = 0
    for family in families:
        collect(family["thumbnail"], family["id"], ())
        for entry in family["entries"]:
            entries += 1
            entry_id = entry["id"]
            template = json.loads((PUBLIC / "templates" / f"{entry_id}.json").read_text())
            collect(entry["thumbnail"], entry_id, ())
            collect(template, entry_id, template.get("referenceScripts", {}))
            visit(template)
    for name, extension in (("kitModelPreviews", "glb"), ("kitTexturePreviews", "webp")):
        manifest = ROOT / f"frontend/src/data/{name}.json"
        if not manifest.is_file():
            continue
        previews = json.loads(manifest.read_text())
        for original, preview in previews.items():
            if f"/kits/assets/{original}" not in referenced:
                raise ValueError(f"Kit preview source is unused: {original}")
            if not re.fullmatch(rf"/kits/assets/[a-f0-9]{{64}}\.{extension}", preview):
                raise ValueError(f"Invalid kit preview asset: {preview}")
            collect(preview, original, ())
    files = [path for path in PUBLIC.rglob("*") if path.is_file() and path != report_path]
    report["localFiles"] = len(files)
    report["localBytes"] = sum(path.stat().st_size for path in files)
    report["unresolvedSourceReferences"] = [{"entry": entry_id, "path": path} for entry_id, path in sorted(unresolved)]
    report["verification"] = {"families": len(families), "entries": entries, "widgets": sum(widget_types.values()),
                              "widgetTypes": dict(widget_types), "optionCount": options,
                              "localFileReferences": sum(referenced.values()), "distinctReferencedAssets": len(referenced)}
    dump(report_path, report)
    print(f"Verified {entries} templates, {sum(widget_types.values())} layers and {len(referenced)} distinct files. "
          f"{len(unresolved)} source references remain.", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default="/tmp/data-wind-reference-templates.json")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--repair-mime", action="store_true")
    parser.add_argument("--repair-references", action="store_true")
    parser.add_argument("--repair-model-directories", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--only", action="append", help="Retry entry IDs containing these strings, retaining the prior report")
    args = parser.parse_args()
    if args.verify:
        verify_corpus()
        return
    if args.repair_mime:
        repair_mime()
        return
    if args.repair_references:
        repair_references()
        return
    if args.repair_model_directories:
        repair_model_directories()
        return
    if args.only and (PUBLIC / "sync-report.json").exists():
        REPORT.update(json.loads((PUBLIC / "sync-report.json").read_text()))
    CACHE.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(Path(args.catalog).read_text())
    kits = next(category for category in catalog if category["type"] == "KIT")
    output = ROOT / "frontend/src/data/referenceKits.json"
    prior_entries = {}
    if args.only and output.exists():
        prior_entries = {entry["id"]: entry for family in json.loads(output.read_text())["families"]
                         for entry in family["entries"]}
    families = []
    entries = []
    for family_index, family in enumerate(kits["children"]):
        family_id = FAMILY_IDS[family_index]
        categories = []
        children = []
        for index, raw in enumerate(family["children"]):
            entry_categories = raw.get("categoryTags") or ["装饰"]
            for category in entry_categories:
                if category not in categories:
                    categories.append(category)
            entry_id = f"{family_id}-{index:03d}-{raw['id']}"
            entry = {
                "id": entry_id, "referenceId": raw["id"], "label": raw["alias"],
                "thumbnail": raw["image"], "category": entry_categories[0],
                "categories": entry_categories, "sourceUrl": raw["url"],
                "template": f"/kits/templates/{entry_id}.json",
                "widgetTypes": [widget["type"] for widget in raw.get("meta", {}).get("widgets", [])],
            }
            if entry_id in prior_entries:
                entry["thumbnail"] = prior_entries[entry_id]["thumbnail"]
            children.append(entry)
            entries.append(entry)
        families.append({"id": family_id, "label": family["label"], "thumbnail": family["image"],
                         "categories": ["全部", *categories], "entries": children})
    dump(output, {"families": families})
    print(f"Catalog ready: {len(families)} families, {len(entries)} entries", flush=True)
    for family in families:
        try:
            thumbnail = download(family["thumbnail"])
            family["thumbnail"] = store_asset(thumbnail.read_bytes(), thumbnail.name, "thumbs")
        except Exception as error:
            REPORT["failures"].append({"family": family["id"], "error": str(error)})
    selected = [entry for entry in entries if any(pattern in entry["id"] for pattern in args.only)] if args.only else entries
    selected = selected[:args.limit] if args.limit else selected
    if args.only:
        selected_ids = {entry["id"] for entry in selected}
        REPORT["packages"] = [item for item in REPORT["packages"] if item.get("id") not in selected_ids]
        REPORT["failures"] = [item for item in REPORT["failures"] if item.get("id") not in selected_ids]
        REPORT["skipped"] = [item for item in REPORT["skipped"] if item.get("entry") not in selected_ids]
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 12))) as executor:
        for _ in executor.map(import_entry, selected):
            completed += 1
            if completed % 20 == 0 or completed == len(selected):
                dump(output, {"families": families})
                dump(PUBLIC / "sync-report.json", REPORT)
                print(f"Imported {completed}/{len(selected)}; failures={len(REPORT['failures'])}; "
                      f"downloaded={REPORT['downloadBytes'] // (1024 * 1024)} MiB", flush=True)
    dump(output, {"families": families})
    REPORT["familyCount"] = len(families)
    REPORT["entryCount"] = len(entries)
    REPORT["importedCount"] = len(REPORT["packages"])
    REPORT["localFiles"] = sum(1 for path in PUBLIC.rglob("*") if path.is_file())
    REPORT["localBytes"] = sum(path.stat().st_size for path in PUBLIC.rglob("*") if path.is_file())
    dump(PUBLIC / "sync-report.json", REPORT)
    summary = {key: REPORT.get(key) for key in (
        "familyCount", "entryCount", "importedCount", "downloadBytes", "localFiles", "localBytes",
    )}
    summary.update({"failureCount": len(REPORT["failures"]), "skippedResourceCount": len(REPORT["skipped"])})
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
