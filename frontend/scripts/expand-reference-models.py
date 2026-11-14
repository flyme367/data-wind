#!/usr/bin/env python3
"""Download attributed CC0 reference GLBs and add them to the local model catalog.

The generated meshes and thumbnails are produced separately by prepare:models.
Existing source entries are preserved, and downloads are checked before the catalog changes.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent / "public" / "models"
HOSPITAL_URL = "https://3dassets.dev/api/v1/packs/hospital-wards-and-clinic-operations"
KENNEY_URL = "https://raw.githubusercontent.com/Hidencod/tge-assets/main/catalog.json"
RAW_ROOT = "https://raw.githubusercontent.com/Hidencod/tge-assets/main/"

MEDICAL_NAMES = [
    "可调节病床", "抬背病床", "日间病床", "儿童病床", "病床床头柜", "跨床餐桌", "生命体征监护仪", "输液架",
    "输液泵架", "床头供氧面板", "医用帘轨", "医用屏风", "轮椅", "病人转运车", "患者升降机", "核磁共振仪",
    "CT扫描仪", "X射线检查台", "超声诊断设备", "心电图推车", "血压监测台", "诊疗检查床", "身高体重测量仪",
    "手术床", "手术无影灯", "麻醉机", "手术器械推车", "手术洗手池", "无菌物资车", "医用吸引机",
    "手术室吊塔", "复苏室躺椅", "药品分发柜", "医用冷藏柜", "医用离心机", "检验显微镜台", "样本试管架",
    "高压灭菌器", "实验准备台", "锐器收集站", "医院接待台", "叫号显示屏", "候诊连排椅", "双人候诊椅",
    "候诊连排椅 · 暖色", "医院单椅", "扶手候诊椅", "医院单椅 · 暖色", "医用饮水机", "自助售货机", "医院信息牌",
    "医院导向牌", "导向牌 · 暖色", "大厅绿植", "杂志茶几", "员工储物柜", "休息桌椅", "医用白板", "清洁推车",
    "医用布草车", "分类垃圾桶", "病历资料架", "茶水台", "医护排班板", "医院救护车", "医院门廊", "医用担架",
    "急救车位标线", "医院隔断墙", "一米隔断墙", "玻璃隔断", "玻璃隔断门", "医院门扇", "医院走廊地砖",
    "医院顶灯", "病房转角墙",
]
MEDICAL_IDS = [
    "23588", "23591", "23592", "23587", "23593", "23590", "23589", "23594", "23595", "23596",
    "23597", "23599", "23600", "23598", "23601", "23602", "23603", "23606", "23604", "23605",
    "23607", "23608", "23609", "23610", "23611", "23612", "23613", "23614", "23615", "23618",
    "23616", "23617", "23619", "23620", "23621", "23622", "23623", "23625", "23624", "23626",
    "23627", "23628", "23629", "23633", "23630", "23631", "23632", "23634", "23635", "23636",
    "23637", "23639", "23638", "23641", "23640", "23642", "23643", "23644", "23645", "23646",
    "23647", "23650", "23648", "23649", "23651", "23652", "23653", "23655", "23654", "23656",
    "23658", "23657", "23659", "23660", "23661", "23662",
]

# 平面构件（门廊/隔断墙/地砖等）已随 2026-11-08 卡通模型下架移除，重跑时不得回填。
# 清单保留完整 76 项以维持对上游 manifest 的位置校验，仅跳过生成条目。
REMOVED_MEDICAL_IDS = {
    "23652", "23655", "23654", "23656", "23658",
    "23657", "23659", "23660", "23661", "23662",
}

# Kenney 卡通系素材（车辆/城规/家具/小人/植被包）已在 2026-11-08 全部下架，不再从 tge-assets 回填。
KENNEY_SELECTION = {}


def fetch_json(url):
    result = subprocess.run(["curl", "-fsSL", "--retry", "2", "--max-time", "60", url],
                            check=True, capture_output=True)
    return json.loads(result.stdout)


def hospital_category(index):
    if index <= 14: return "医疗 / 病房护理"
    if index <= 22: return "医疗 / 影像诊疗"
    if index <= 31: return "医疗 / 手术设备"
    if index <= 39: return "医疗 / 药房检验"
    if index <= 54: return "家具 / 公共空间"
    if index <= 63: return "家具 / 办公配套"
    if index == 64: return "交通 / 应急车辆"
    if index == 65: return "建筑 / 医院构件"
    if index == 66: return "医疗 / 急救设备"
    return "建筑 / 医院构件"


def download(entry):
    path = ROOT / "sources" / (entry["id"] + ".glb")
    if path.exists() and path.stat().st_size > 20 and path.read_bytes()[:4] == b"glTF":
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        temporary = Path(tmp.name)
    try:
        subprocess.run(["curl", "-fsSL", "--retry", "2", "--retry-delay", "1", "--max-time", "50",
                        "-o", str(temporary), entry["download"]], check=True, capture_output=True)
        if temporary.stat().st_size < 20 or temporary.read_bytes()[:4] != b"glTF":
            raise ValueError("Downloaded file is not a GLB: " + entry["id"])
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    hospital = fetch_json(HOSPITAL_URL)["data"]
    assets = hospital["assets"]
    if ([a["id"] for a in assets[:len(MEDICAL_IDS)]] != MEDICAL_IDS or
            any(a["license"]["slug"] != "cc0-1.0" for a in assets[:len(MEDICAL_IDS)])):
        raise ValueError("Hospital manifest changed or contains an unexpected license")
    entries = []
    for index, name in enumerate(MEDICAL_NAMES):
        asset = assets[index]
        if asset["id"] in REMOVED_MEDICAL_IDS:
            continue
        entries.append({"id": "medical-" + asset["id"], "name": name, "category": hospital_category(index),
                        "source": asset["url"], "download": asset["cdnUrl"], "author": "3D Assets",
                        "license": "CC0-1.0", "pack": "Hospital Wards and Clinic Operations",
                        "unitScale": 2, "aiGenerated": asset.get("aiGenerated", False)})
    if KENNEY_SELECTION:
        kenney = fetch_json(KENNEY_URL)
        packs = {pack["id"]: pack for pack in kenney["packs"]}
        for pack_id, selection in KENNEY_SELECTION.items():
            pack = packs[pack_id]
            models = {item["id"].split("/")[-1]: item for item in pack["models"]}
            for slug, name, category in selection:
                model = models[slug]
                entries.append({"id": "kenney-" + pack_id + "-" + slug, "name": name, "category": category,
                                "source": pack["url"], "download": RAW_ROOT + model["file"], "author": "Kenney",
                                "license": "CC0-1.0", "pack": pack["name"]})
    ROOT.joinpath("sources").mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        for index, _ in enumerate(executor.map(download, entries), 1):
            if index % 20 == 0 or index == len(entries):
                print("Downloaded {}/{} reference models".format(index, len(entries)), flush=True)
    sources_path = ROOT / "sources.json"
    existing = json.loads(sources_path.read_text())
    new_ids = {entry["id"] for entry in entries}
    merged = [entry for entry in existing if entry["id"] not in new_ids] + entries
    sources_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n")
    print("Catalog contains {} source models".format(len(merged)), flush=True)


if __name__ == "__main__":
    main()
