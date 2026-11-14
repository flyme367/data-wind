import type { SceneNode } from "../types";
import { widgetLabels, widgetNode, type WidgetKind } from "./editor";

/** 山海鲸「地图」分类 chips（1:1）：「全部」始终在首位。 */
export const mapCategories = ["全部", "轮廓地图", "瓦片地图", "三维地图"] as const;
export type MapCategory = Exclude<(typeof mapCategories)[number], "全部">;

export interface MapCatalogEntry {
  kind: WidgetKind;
  label: string;
  category: MapCategory;
  /** 卡片缩略图：generate-map-thumbs.mjs 按自家主题渲染产出的 webp（不拷贝山海鲸图片）。 */
  image: string;
  /** 山海鲸「基」角标（基础版可用标记）。 */
  base?: boolean;
  /** 插入时的 data 覆盖（区域 / 主题 / 视野 preset）。 */
  data?: Record<string, unknown>;
  /** 山海鲸分组卡（世界地图一/二）：整组插入 = 背景装饰 + 地图组件。 */
  group?: boolean;
}

const tileData = (theme: string, extra: Record<string, unknown> = {},
  imagery: "none" | "satellite" | "street" = "none"): Record<string, unknown> => ({
  // 山海鲸 GIS 变体默认中国省级视图：省界主题配色 + 区域名 + 首都（北京市）高亮
  region: "china", theme,
  tile: { centerLon: 105, centerLat: 36, zoom: 1, minZoom: 1, maxZoom: 12, moveZoom: true, tileSource: "内置主题", imagery },
  rows: [{ name: "北京市", value: 96 }],
  ...extra,
});

/** 地图素材目录：山海鲸 4.7.13「地图」分类 16 项 1:1（三维地图 3 项为 3D 场景组件，
 *  看板 2D 渲染器以内置主题风格化近似呈现，边界结论见 docs/map-components-sync.md）。 */
export const mapCatalog: MapCatalogEntry[] = [
  // 轮廓地图 6 项
  { kind: "mapOutline", label: "中国地图", category: "轮廓地图", image: "/reference/map-china.webp",
    data: { region: "china", text: "中国地图" } },
  { kind: "mapOutline", label: "世界地图", category: "轮廓地图", image: "/reference/map-world.webp",
    data: { region: "world", text: "世界地图" } },
  { kind: "mapOutline", label: "美国地图", category: "轮廓地图", image: "/reference/map-usa.webp",
    data: { region: "usa", text: "美国地图" } },
  { kind: "mapOutline", label: "自定义地图", category: "轮廓地图", image: "/reference/map-custom.webp",
    data: { region: "custom", text: "自定义地图" } },
  { kind: "mapTile", label: "世界地图一", category: "轮廓地图", image: "/reference/map-world-1.webp", base: true, group: true,
    data: { region: "world", theme: "realistic-3d", text: "世界地图一" } },
  { kind: "mapTile", label: "世界地图二", category: "轮廓地图", image: "/reference/map-world-2.webp", base: true,
    data: { region: "world", theme: "satellite", text: "世界地图二" } },
  // 瓦片地图 7 项
  { kind: "mapTile", label: "GIS卫星地图（卫星）", category: "瓦片地图", image: "/reference/map-gis-satellite.webp", base: true,
    data: tileData("satellite", { text: "GIS卫星地图（卫星）" }, "satellite") },
  { kind: "mapTile", label: "GIS电子地图（基础）", category: "瓦片地图", image: "/reference/map-gis-basic.webp", base: true,
    data: tileData("basic", { text: "GIS电子地图（基础）" }, "street") },
  { kind: "mapTile", label: "GIS地图（黑金）", category: "瓦片地图", image: "/reference/map-gis-black-gold.webp", base: true,
    data: tileData("black-gold", { text: "GIS地图（黑金）" }) },
  { kind: "mapTile", label: "GIS地图（蓝黑）", category: "瓦片地图", image: "/reference/map-gis-blue-black.webp", base: true,
    data: tileData("blue-black", { text: "GIS地图（蓝黑）" }) },
  { kind: "mapTile", label: "GIS地图（草绿）", category: "瓦片地图", image: "/reference/map-gis-grass-green.webp", base: true,
    data: tileData("grass-green", { text: "GIS地图（草绿）" }) },
  { kind: "mapTile", label: "GIS地图（浅蓝）", category: "瓦片地图", image: "/reference/map-gis-light-blue.webp", base: true,
    data: tileData("light-blue", { text: "GIS地图（浅蓝）" }) },
  { kind: "mapTile", label: "GIS地图（深蓝）", category: "瓦片地图", image: "/reference/map-gis-deep-blue.webp", base: true,
    data: tileData("deep-blue", { text: "GIS地图（深蓝）" }) },
  // 三维地图 3 项（2D 风格化近似）
  { kind: "mapTile", label: "3D GIS底座", category: "三维地图", image: "/reference/map-gis-3d-base.webp", base: true,
    data: tileData("gis3d-base", { text: "3D GIS底座" }) },
  { kind: "mapTile", label: "科技风3D地图", category: "三维地图", image: "/reference/map-tech-3d.webp", base: true,
    data: tileData("tech-3d", { text: "科技风3D地图" }) },
  { kind: "mapTile", label: "写实风3D地图", category: "三维地图", image: "/reference/map-realistic-3d.webp", base: true,
    data: tileData("realistic-3d", { text: "写实风3D地图" }) },
];

/** 旧「数据图层」六类（区域/点/飞线/热力/轨迹/柱状地图）：旧项目继续渲染，目录不再占位，
 *  仅在地图面板搜索时可见（山海鲸地图分类无此六项，保持 1:1）。 */
export const legacyMapCategories = ["数据图层"] as const;

export interface LegacyMapCatalogEntry {
  kind: WidgetKind; label: string; category: "数据图层";
}

export const legacyMapCatalog: LegacyMapCatalogEntry[] = [
  { kind: "mapRegion", label: "区域地图", category: "数据图层" },
  { kind: "mapPoint", label: "点地图", category: "数据图层" },
  { kind: "mapFlyline", label: "飞线地图", category: "数据图层" },
  { kind: "mapHeat", label: "热力地图", category: "数据图层" },
  { kind: "mapTrack", label: "轨迹地图", category: "数据图层" },
  { kind: "mapBar", label: "柱状地图", category: "数据图层" },
];

/** 有素材的分类才会显示对应 chip。 */
export const usedMapCategories = mapCategories;

const applyEntryData = (node: SceneNode, entry: MapCatalogEntry): SceneNode => {
  const { text, ...rest } = entry.data ?? {};
  if (text) node.widget = { ...node.widget!, text: String(text) };
  node.data = { ...node.data, ...rest };
  return node;
};

/** 单组件卡：kind 预设 + 目录条目的区域/主题覆盖。 */
export function mapPaletteNode(entry: MapCatalogEntry): SceneNode {
  const node = widgetNode(entry.kind) as SceneNode;
  node.id = `map-${entry.label}`;
  node.name = entry.label;
  return applyEntryData(node, entry);
}

/** 分组卡（世界地图一/二 = 背景 + 地图整组，仿山海鲸「分组面板」）。 */
export function mapGroupNodes(entry: MapCatalogEntry, origin: { x: number; y: number } = { x: 80, y: 80 }): SceneNode[] {
  const dark = entry.data?.theme === "satellite";
  const background = widgetNode("shape") as SceneNode;
  background.id = `map-bg-${entry.label}`;
  background.name = "背景";
  background.color = dark ? "#d8e4ec" : "#0a0f1a";
  background.data = { ...background.data, shape: "rect" };
  background.widget = { ...background.widget!, text: "背景", background: "transparent", borderColor: "transparent" };
  background.boxSize = { x: 1280, y: 720, z: 1 };
  background.transform = { ...background.transform, position: { x: origin.x, y: origin.y, z: 0 } };
  const map = applyEntryData(widgetNode(entry.kind) as SceneNode, entry);
  map.id = `map-node-${entry.label}`;
  // 山海鲸树结构：世界地图一（分组）内含 世界地图二 + 背景
  map.name = entry.label === "世界地图一" ? "世界地图二" : entry.label;
  map.boxSize = { x: 1180, y: 620, z: 1 };
  map.transform = { ...map.transform, position: { x: origin.x + 50, y: origin.y + 50, z: 0 } };
  return [background, map];
}

/** 面板/目录共用的种类标签（世界地图一/二 显示「分组面板」，与山海鲸面板头一致）。 */
export const mapEntryTypeLabel = (entry: MapCatalogEntry): string =>
  entry.group ? "分组面板" : widgetLabels[entry.kind];
