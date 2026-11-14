import type { SceneNode } from "../types";

/** 看板地图共享模块：加载 Natural Earth 国界 + DataV 中国省界 + US Census 州界（与 3D GIS 素材同一份国界数据），
 *  按组件 kind 生成 SVG 内层字符串，编辑器 / 发布端 / 缩略图三端共用。
 *  山海鲸「地图」分类同步：轮廓地图（区域子集 + 底图层/呼吸点层配置）与瓦片地图（内置主题风格化渲染）见 docs/map-components-sync.md。 */
export const MAP_VIEW = { width: 720, height: 360 };

export const mapWidgetKinds = ["mapRegion", "mapPoint", "mapFlyline", "mapHeat", "mapTrack", "mapBar", "mapOutline", "mapTile"] as const;
export type MapWidgetKind = (typeof mapWidgetKinds)[number];
export const isMapWidget = (kind: string): kind is MapWidgetKind => (mapWidgetKinds as readonly string[]).includes(kind);

/** 世界全图投影（等距圆柱），旧六类数据地图继续用这套坐标。 */
export const projectPoint = (lon: number, lat: number): [number, number] => [
  ((lon + 180) / 360) * MAP_VIEW.width,
  ((90 - lat) / 180) * MAP_VIEW.height,
];

/** 山海鲸「地图投影方式」：默认 = 等距圆柱，墨卡托 = 区域地图缺省（中国/美国的常见观感）。 */
const mercatorY = (lat: number): number => {
  const clamped = Math.max(-85, Math.min(85, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
};

/** 区域视野：区域子集渲染的经纬范围与投影方式。 */
export const REGION_VIEWS: Record<string, { lonMin: number; lonMax: number; latMin: number; latMax: number; projection: "equirect" | "mercator" }> = {
  world: { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90, projection: "equirect" },
  china: { lonMin: 73.4, lonMax: 135.2, latMin: 15.6, latMax: 54.3, projection: "mercator" },
  usa: { lonMin: -125.6, lonMax: -65.4, latMin: 23.6, latMax: 50.6, projection: "mercator" },
};

/** 视野 → 投影函数：zoom 语义同瓦片（每 +1 经度跨度减半），围绕 centerLon/centerLat 放大。
 *  墨卡托先把纬度换算成 y 值再做线性缩放（锚点只换算一次，避免双重换算）。 */
export function makeProjector(view: { lonMin: number; lonMax: number; latMin: number; latMax: number; projection: "equirect" | "mercator" },
  tile?: { centerLon?: number; centerLat?: number; zoom?: number }): (lon: number, lat: number) => [number, number] {
  const window = mapTileWindow(view, tile);
  return (lon, lat) => [
    ((lon - window.lonMin) / window.lonSpan) * MAP_VIEW.width,
    ((window.top - window.projectLat(lat)) / window.latSpan) * MAP_VIEW.height,
  ];
}

/** 当前视野的经纬/墨卡托窗口（makeProjector 的展开形式，供在线瓦片影像合成器复用同一缩放语义）。 */
export function mapTileWindow(view: { lonMin: number; lonMax: number; latMin: number; latMax: number; projection: "equirect" | "mercator" },
  tile?: { centerLon?: number; centerLat?: number; zoom?: number }): {
  lonMin: number; lonMax: number; top: number; bottom: number; lonSpan: number; latSpan: number;
  projectLat: (lat: number) => number;
} {
  const projectLat = view.projection === "mercator" ? mercatorY : (lat: number) => lat;
  let lonMin = view.lonMin, lonMax = view.lonMax;
  let top = projectLat(view.latMax), bottom = projectLat(view.latMin);
  const zoom = Math.max(0, Number(tile?.zoom ?? 1) - 1);
  if (zoom > 0 && tile) {
    const spanLon = (lonMax - lonMin) / 2 ** zoom;
    const spanLat = (top - bottom) / 2 ** zoom;
    const centerLon = tile.centerLon ?? (view.lonMin + view.lonMax) / 2;
    const centerLat = projectLat(tile.centerLat ?? (view.latMin + view.latMax) / 2);
    lonMin = centerLon - spanLon / 2;
    lonMax = centerLon + spanLon / 2;
    top = centerLat + spanLat / 2;
    bottom = centerLat - spanLat / 2;
  }
  return {
    lonMin, lonMax, top, bottom,
    lonSpan: Math.max(lonMax - lonMin, 0.0001),
    latSpan: Math.max(top - bottom, 0.0001),
    projectLat,
  };
}

/** 山海鲸「瓦片地图」内置主题（离线矢量风格化渲染，非在线影像）：变体只是外观不同，配置结构一致。 */
export interface MapThemePalette {
  ocean: string; land: string; border: string; label: string; graticule: string;
  /** 主题底色上的高亮（区域 value / 呼吸点）缺省色 */
  highlight: string;
  /** 外发光色（科技风主题用） */
  glow?: string;
  /** 陆地亮暗渐变端（模拟地形/光照） */
  landLight?: string;
}
export const MAP_THEMES: Record<string, MapThemePalette> = {
  outline: { ocean: "#0d1c30", land: "#1b3350", border: "#2c4a6e", label: "#9fc6e8", graticule: "#ffffff0d", highlight: "#6cbcff" },
  satellite: { ocean: "#0a1a2f", land: "#3d5230", border: "#5d7a48", label: "#d7e6d0", graticule: "#ffffff08", highlight: "#ffd66b", landLight: "#7a8f5a" },
  basic: { ocean: "#a8d3e2", land: "#f4f1ea", border: "#c5c2b8", label: "#5a6b7a", graticule: "#0000000a", highlight: "#e8912d" },
  "black-gold": { ocean: "#0a0a0c", land: "#16171b", border: "#c9a227", label: "#e8d48b", graticule: "#c9a22714", highlight: "#ffd700", glow: "#c9a227" },
  "blue-black": { ocean: "#080f1e", land: "#0f1c31", border: "#2f5d8a", label: "#8fb8dd", graticule: "#3f8cff10", highlight: "#3f8cff", glow: "#2b6cb0" },
  "grass-green": { ocean: "#07211b", land: "#1d5c38", border: "#3aa065", label: "#bfe6cd", graticule: "#3aa06512", highlight: "#a3e635", glow: "#3aa065" },
  "light-blue": { ocean: "#cfe4f2", land: "#f0f7fc", border: "#8fbedd", label: "#4a6a85", graticule: "#8fbedd40", highlight: "#2f7fe8" },
  "deep-blue": { ocean: "#040a16", land: "#0c1a31", border: "#1f3c66", label: "#6d93c4", graticule: "#1f3c6620", highlight: "#4da3ff", glow: "#16365c" },
  "gis3d-base": { ocean: "#050b16", land: "#101d33", border: "#28486e", label: "#7fa8d4", graticule: "#28486e26", highlight: "#3f8cff", glow: "#1d3a5f", landLight: "#1c3050" },
  "tech-3d": { ocean: "#030812", land: "#0a1830", border: "#19c2ff", label: "#9be4ff", graticule: "#19c2ff18", highlight: "#19e0ff", glow: "#19c2ff" },
  "realistic-3d": { ocean: "#0a1626", land: "#33452c", border: "#54683f", label: "#cfe0c0", graticule: "#ffffff07", highlight: "#ffd66b", landLight: "#5d7346" },
};

export const MAP_THEME_OPTIONS: { value: string; label: string }[] = [
  { value: "satellite", label: "卫星" }, { value: "basic", label: "基础" },
  { value: "black-gold", label: "黑金" }, { value: "blue-black", label: "蓝黑" },
  { value: "grass-green", label: "草绿" }, { value: "light-blue", label: "浅蓝" },
  { value: "deep-blue", label: "深蓝" }, { value: "gis3d-base", label: "3D GIS底座" },
  { value: "tech-3d", label: "科技风3D" }, { value: "realistic-3d", label: "写实风3D" },
];

export interface WorldGeo {
  countries: { name: string; nameZh: string; dataset: string; d: string; rings: number[][][] }[];
  byName: Map<string, { name: string; nameZh: string; dataset: string; d: string; rings: number[][][] }>;
  byDataset: Map<string, { name: string; nameZh: string; dataset: string; d: string; rings: number[][][] }[]>;
}

const OCEAN = "#0d1c30";
const LAND = "#1b3350";
const BORDER = "#2c4a6e";
const FALLBACK_COLOR = "#6cbcff";

let worldGeo: WorldGeo | null = null;
let worldGeoPromise: Promise<WorldGeo | null> | null = null;
const listeners = new Set<() => void>();

export const worldGeoReady = (): boolean => worldGeo !== null;

/** 地理数据就绪 / 加载完成的订阅，返回取消函数；组件用它触发一次重渲染。 */
export function onWorldGeo(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

type GeoFeature = Record<string, unknown> & {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
};

const readGeo = async (response: Response): Promise<{ features?: GeoFeature[] }> => {
  if (!response.ok) throw new Error("地图边界加载失败");
  return response.json();
};

/** 数据源小写 name 归一化：china 是中文名 → NAME_ZH；usa 是英文名 → NAME（与 boardCanvas 下发同一套规则）。 */
const tagDataset = (dataset: string) => (feature: GeoFeature): GeoFeature => {
  const props = (feature.properties as Record<string, unknown> ?? {});
  const label = String(props.name ?? "");
  return { ...feature, properties: {
    ...props, DATASET: dataset,
    NAME: dataset === "usa" ? label : String(props.NAME ?? label),
    NAME_ZH: dataset === "china" ? label : String(props.NAME_ZH ?? ""),
  } };
};

const featurePath = (rings: number[][][], project: (lon: number, lat: number) => [number, number]): string =>
  rings.map((ring) => ring.map(([lon, lat], index) => {
    const [x, y] = project(lon, lat);
    return `${index ? "L" : "M"}${round1(x)},${round1(y)}`;
  }).join("") + "Z").join("");

const featureRings = (geometry?: { type?: string; coordinates?: unknown }): number[][][] => {
  if (geometry?.type === "Polygon" && Array.isArray(geometry.coordinates)) return geometry.coordinates as number[][][];
  if (geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as number[][][][]).flatMap((polygon) => polygon as number[][][]);
  }
  return [];
};

export function loadWorldGeo(): Promise<WorldGeo | null> {
  if (worldGeoPromise) return worldGeoPromise;
  worldGeoPromise = Promise.all([
    fetch("./gis/ne_110m_admin_0_countries.geojson").then(readGeo),
    fetch("./gis/china-provinces.geojson").then(readGeo).catch(() => ({ features: [] })),
    fetch("./gis/us-states.geojson").then(readGeo).catch(() => ({ features: [] })),
  ]).then(([world, china, usa]) => {
    const countries = [
      ...((world.features ?? []) as Record<string, unknown>[]).map(tagDataset("world")),
      ...((china.features ?? []) as Record<string, unknown>[]).map(tagDataset("china")),
      ...((usa.features ?? []) as Record<string, unknown>[]).map(tagDataset("usa")),
    ].map((feature) => {
      const props = feature.properties as Record<string, unknown>;
      const rings = featureRings(feature.geometry);
      return {
        name: String(props.NAME ?? ""), nameZh: String(props.NAME_ZH ?? ""), dataset: String(props.DATASET ?? "world"),
        rings, d: featurePath(rings, projectPoint),
      };
    }).filter((country) => country.d && country.rings.length);
    const byName = new Map<string, WorldGeo["countries"][number]>();
    for (const country of countries) {
      if (country.name) byName.set(country.name, country);
      if (country.nameZh) byName.set(country.nameZh, country);
    }
    const byDataset = new Map<string, WorldGeo["countries"]>();
    for (const country of countries) {
      const list = byDataset.get(country.dataset) ?? [];
      list.push(country);
      byDataset.set(country.dataset, list);
    }
    worldGeo = countries.length ? { countries, byName, byDataset } : null;
    if (worldGeo) listeners.forEach((fn) => fn());
    return worldGeo;
  })
    .catch(() => null);
  return worldGeoPromise;
}

/** 行数据：区域地图只填 name/value，点 / 飞线地图额外带 lon/lat。 */
export function mapRows(node: SceneNode): { name: string; value: number; lon: number; lat: number }[] {
  const raw = Array.isArray(node.data?.rows) ? node.data!.rows : [];
  return raw.slice(0, 60).map((item, index) => {
    const row = item as Record<string, unknown>;
    return {
      name: String(row?.name ?? index + 1),
      value: Math.max(0, Number(row?.value) || 0),
      lon: Number(row?.lon),
      lat: Number(row?.lat),
    };
  });
}

const safeColor = (color: string): string =>
  /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : FALLBACK_COLOR;

const hexToRgb = (hex: string): [number, number, number] => {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((ch) => ch + ch).join("") : value;
  const number = Number.parseInt(full, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
};

export const mixColor = (from: string, to: string, t: number): string => {
  const a = hexToRgb(from), b = hexToRgb(to);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
};

/** 底图层配置（山海鲸「底图层 → 基本设置」全量字段），缺字段回落预设默认。 */
export interface MapLayerConfig {
  fillType: "color" | "image"; fillImage: string;
  defaultColor: string; highlightColor: string; selectedColor: string;
  borderColor: string; borderWidth: number; borderStyle: "solid" | "dotted";
  outlineColor: string; outlineWidth: number; outlineGlow: number; glowColor: string;
  shadowSize: number; shadowColor: string;
  showRegionNames: boolean; forceShowNames: boolean;
  nameFont: { family: string; size: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean };
}

const DEFAULT_MAP_LAYER: MapLayerConfig = {
  fillType: "color", fillImage: "", defaultColor: "#1b3350", highlightColor: "#6cbcff", selectedColor: "#2f7fe8",
  borderColor: "#2c4a6e", borderWidth: 1, borderStyle: "dotted",
  outlineColor: "#3d6a9e", outlineWidth: 0, outlineGlow: 0, glowColor: "#4da3ff",
  shadowSize: 0, shadowColor: "#000000",
  showRegionNames: true, forceShowNames: false,
  nameFont: { family: "", size: 12, bold: false, italic: false, underline: false, strike: false },
};

const readGroup = (node: SceneNode, key: string): Record<string, unknown> =>
  (node.data?.[key] && typeof node.data![key] === "object" ? node.data![key] : {}) as Record<string, unknown>;

export function mapLayerConfig(node: SceneNode): MapLayerConfig {
  const raw = readGroup(node, "map");
  return {
    ...DEFAULT_MAP_LAYER,
    ...raw,
    nameFont: { ...DEFAULT_MAP_LAYER.nameFont, ...raw.nameFont as Partial<MapLayerConfig["nameFont"]> },
  } as MapLayerConfig;
}

/** 自定义地图（山海鲸「选择geojson文件」）：data.geojson 内嵌 GeoJSON（≤1.5MB，上传时限制）。 */
const customFeatures = (node: SceneNode): { name: string; nameZh: string; rings: number[][][] }[] => {
  const raw = node.data?.geojson;
  if (!raw || typeof raw !== "object") return [];
  const features = Array.isArray((raw as { features?: unknown }).features)
    ? (raw as { features: unknown[] }).features : [];
  return features.slice(0, 300).map((feature) => {
    const props = ((feature as Record<string, unknown>)?.properties ?? {}) as Record<string, unknown>;
    const label = String(props.name ?? props.NAME ?? "");
    return {
      name: label, nameZh: String(props.NAME_ZH ?? label),
      rings: featureRings((feature as Record<string, unknown>)?.geometry as { type?: string; coordinates?: unknown }),
    };
  }).filter((feature) => feature.rings.length);
};

/** 环最大子环的质心（区域名称标注锚点；Rust 端 maps.rs 用同一套鞋带公式）。 */
export const ringCentroid = (ring: number[][]): [number, number] => {
  let sumX = 0, sumY = 0, sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index]!, [x2, y2] = ring[index + 1]!;
    const cross = x1 * y2 - x2 * y1;
    sumX += (x1 + x2) * cross; sumY += (y1 + y2) * cross; sum += cross;
  }
  if (Math.abs(sum) < 1e-9) return ring[0] ? [ring[0][0] ?? 0, ring[0][1] ?? 0] : [0, 0];
  return [sumX / (3 * sum), sumY / (3 * sum)];
};

const largestRing = (rings: number[][][]): number[][] =>
  rings.reduce((best, ring) => {
    const area = Math.abs(ring.reduce((acc, [x, y], index) => {
      const [px, py] = ring[index - 1] ?? ring[ring.length - 1]!;
      return acc + (px * y - x * py);
    }, 0));
    return area > best.area ? { area, ring } : best;
  }, { area: -1, ring: rings[0] ?? [] }).ring;

const graticule = (stroke: string): string => {
  let lines = "";
  for (let lon = -150; lon <= 180; lon += 30) {
    const [x] = projectPoint(lon, 0);
    lines += `<line x1="${round1(x)}" y1="0" x2="${round1(x)}" y2="${MAP_VIEW.height}"/>`;
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = projectPoint(0, lat);
    lines += `<line x1="0" y1="${round1(y)}" x2="${MAP_VIEW.width}" y2="${round1(y)}"/>`;
  }
  return `<g stroke="${stroke}" stroke-width="1">${lines}</g>`;
};

const pointsOverlay = (rows: { name: string; value: number; lon: number; lat: number }[], max: number, color: string): string =>
  rows.filter((row) => Number.isFinite(row.lon) && Number.isFinite(row.lat)).map((row) => {
    const [x, y] = projectPoint(row.lon, row.lat);
    const radius = 3 + 8 * (row.value / max);
    return `<circle cx="${round1(x)}" cy="${round1(y)}" r="${round1(radius * 2)}" fill="${color}" fill-opacity=".16"/>` +
      `<circle cx="${round1(x)}" cy="${round1(y)}" r="${round1(radius)}" fill="${color}" fill-opacity=".88"/>`;
  }).join("");

const flylineOverlay = (rows: { name: string; value: number; lon: number; lat: number }[], max: number, color: string, origin: number[]): string => {
  const [ox, oy] = projectPoint(origin[0] ?? 116.4, origin[1] ?? 39.9);
  const arcs = rows.filter((row) => Number.isFinite(row.lon) && Number.isFinite(row.lat)).map((row) => {
    const [x, y] = projectPoint(row.lon, row.lat);
    const lift = Math.abs(x - ox) * 0.24 + 16;
    const mx = (ox + x) / 2, my = Math.min(oy, y) - lift;
    const width = round1(0.9 + 1.4 * (row.value / max));
    return `<path d="M${round1(ox)},${round1(oy)} Q${round1(mx)},${round1(my)} ${round1(x)},${round1(y)}" fill="none" stroke="${color}" stroke-opacity=".72" stroke-width="${width}"/>` +
      `<circle cx="${round1(x)}" cy="${round1(y)}" r="2.6" fill="${color}"/>`;
  }).join("");
  return arcs +
    `<circle cx="${round1(ox)}" cy="${round1(oy)}" r="6.5" fill="${color}" fill-opacity=".28"/>` +
    `<circle cx="${round1(ox)}" cy="${round1(oy)}" r="3.2" fill="${color}" stroke="#ffffff" stroke-width=".8"/>`;
};

/** 热力地图：同心圆叠层模拟径向衰减，无需渐变 defs（避免多实例 id 冲突）。 */
const heatOverlay = (rows: { name: string; value: number; lon: number; lat: number }[], max: number, color: string): string =>
  rows.filter((row) => Number.isFinite(row.lon) && Number.isFinite(row.lat)).map((row) => {
    const [x, y] = projectPoint(row.lon, row.lat);
    const radius = 10 + 26 * (row.value / max);
    return `<circle cx="${round1(x)}" cy="${round1(y)}" r="${round1(radius)}" fill="${color}" fill-opacity=".07"/>` +
      `<circle cx="${round1(x)}" cy="${round1(y)}" r="${round1(radius * 0.62)}" fill="${color}" fill-opacity=".14"/>` +
      `<circle cx="${round1(x)}" cy="${round1(y)}" r="${round1(radius * 0.3)}" fill="${color}" fill-opacity=".3"/>`;
  }).join("");

/** 轨迹地图：按行顺序连线，虚线流动动画（board.css 的 track-flow），起终点加标记。 */
const trackOverlay = (rows: { name: string; value: number; lon: number; lat: number }[], color: string): string => {
  const points = rows.filter((row) => Number.isFinite(row.lon) && Number.isFinite(row.lat));
  if (points.length < 2) return "";
  const projected = points.map((row) => projectPoint(row.lon, row.lat));
  const path = projected.map(([x, y], index) => `${index ? "L" : "M"}${round1(x)},${round1(y)}`).join("");
  const dots = projected.map(([x, y]) => `<circle cx="${round1(x)}" cy="${round1(y)}" r="2.2" fill="${color}"/>`).join("");
  const [sx, sy] = projected[0]!, [ex, ey] = projected[projected.length - 1]!;
  return `<path d="${path}" fill="none" stroke="${color}" stroke-opacity=".35" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path class="track-flow" d="${path}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>` +
    dots +
    `<circle cx="${round1(sx)}" cy="${round1(sy)}" r="4" fill="${color}" stroke="#ffffff" stroke-width=".9"/>` +
    `<path d="M${round1(ex)},${round1(ey)} m-4,0 8,0 0,-8 -3,2.4 -2.5,-2.4 Z" fill="${color}" stroke="#ffffff" stroke-width=".7"/>`;
};

/** 柱状地图：伪 3D 立柱，高度随数值，顶面提亮，底部带光晕。 */
const barOverlay = (rows: { name: string; value: number; lon: number; lat: number }[], max: number, color: string): string =>
  rows.filter((row) => Number.isFinite(row.lon) && Number.isFinite(row.lat)).map((row) => {
    const [x, y] = projectPoint(row.lon, row.lat);
    const height = 12 + 74 * (row.value / max);
    const width = 5.6;
    const top = y - height;
    const cap = mixColor(color, "#ffffff", 0.4);
    return `<circle cx="${round1(x)}" cy="${round1(y)}" r="5" fill="${color}" fill-opacity=".25"/>` +
      `<rect x="${round1(x - width / 2)}" y="${round1(top)}" width="${width}" height="${round1(height)}" fill="${color}" fill-opacity=".82"/>` +
      `<rect x="${round1(x - width / 2 - 1)}" y="${round1(top - 2.4)}" width="${width + 2}" height="2.4" fill="${cap}"/>`;
  }).join("");

/** 呼吸点层（山海鲸「呼吸点层」：显示名称/形状/最小最大半径/颜色），CSS class map-breath 做呼吸动画。 */
export const breathOverlay = (node: SceneNode, project: (lon: number, lat: number) => [number, number]): string => {
  const breath = readGroup(node, "breath");
  const color = safeColor(String(breath.color ?? "#ffd66b"));
  const minR = Math.max(1, Number(breath.minR ?? 5));
  const maxR = Math.max(minR, Number(breath.maxR ?? 15));
  const showName = breath.showName === true;
  const rows = mapRows(node).filter((row) => Number.isFinite(row.lon) && Number.isFinite(row.lat));
  const max = Math.max(...rows.map((row) => row.value), 1);
  return rows.map((row) => {
    const [x, y] = project(row.lon, row.lat);
    const r = round1(minR + (maxR - minR) * (row.value / max));
    const label = showName ? `<text x="${round1(x)}" y="${round1(y - r - 4)}" text-anchor="middle" font-size="11" fill="${color}" fill-opacity=".92">${row.name}</text>` : "";
    return `<g class="map-breath"><circle cx="${round1(x)}" cy="${round1(y)}" r="${round1(r * 1.9)}" fill="${color}" fill-opacity=".14"/>` +
      `<circle cx="${round1(x)}" cy="${round1(y)}" r="${r}" fill="${color}" fill-opacity=".9"/></g>${label}`;
  }).join("");
};

/** 名称字体片段（底图层「名称字体」：字体/字号/加粗/倾斜/下划线/删除线）。 */
const nameFontAttrs = (font: MapLayerConfig["nameFont"]): string => {
  const family = font.family ? ` font-family="${font.family}"` : "";
  const weight = font.bold ? ' font-weight="700"' : "";
  const style = font.italic ? ' font-style="italic"' : "";
  const deco = font.underline || font.strike
    ? ` text-decoration="${[font.underline ? "underline" : "", font.strike ? "line-through" : ""].filter(Boolean).join(" ")}"`
    : "";
  return `${family}${weight}${style}${deco}`;
};

/** 轮廓地图：区域子集 + 底图层全量配置（填充/分界线/外轮廓/阴影/区域名称）+ 呼吸点层。 */
function outlineSvg(node: SceneNode): string | null {
  if (!worldGeo) return null;
  const region = String(node.data?.region ?? "china");
  const layer = mapLayerConfig(node);
  const projection = String(node.data?.projection ?? "mercator");
  const baseView = REGION_VIEWS[region] ?? REGION_VIEWS.china!;
  const view = { ...baseView, projection: projection === "equirect" ? "equirect" : baseView.projection } as const;
  const project = makeProjector(view);
  const features = region === "custom"
    ? customFeatures(node).map((feature) => ({ ...feature, dataset: "custom", d: featurePath(feature.rings, project) }))
    : (worldGeo.byDataset.get(region) ?? []).map((country) => ({ ...country, d: featurePath(country.rings, project) }));
  if (!features.length) return null;
  const rows = mapRows(node);
  const max = Math.max(...rows.map((row) => row.value), 1);
  const fillImage = layer.fillType === "image" && layer.fillImage;
  const parts: string[] = [fillImage
    ? `<image href="${fillImage}" x="0" y="0" width="${MAP_VIEW.width}" height="${MAP_VIEW.height}" preserveAspectRatio="xMidYMid slice" opacity=".9"/>`
    : `<rect width="${MAP_VIEW.width}" height="${MAP_VIEW.height}" fill="${mixColor(layer.defaultColor, "#000000", 0.55)}"/>`];
  const dash = layer.borderStyle === "dotted" ? ` stroke-dasharray="2 2.4"` : "";
  for (const feature of features) {
    const row = rows.find((item) => item.name === feature.name || item.name === feature.nameZh);
    const fill = row
      ? mixColor(layer.highlightColor, "#ffffff", 0.15 * (1 - row.value / max))
      : layer.defaultColor;
    const opacity = row ? (0.35 + 0.65 * (row.value / max)).toFixed(2) : "1";
    parts.push(`<path d="${feature.d}" fill="${fill}" fill-opacity="${opacity}" stroke="${layer.borderColor}" stroke-width="${layer.borderWidth}"${dash}/>` +
      (row && layer.selectedColor !== layer.highlightColor ? `<path d="${feature.d}" fill="none" stroke="${layer.selectedColor}" stroke-width="${Math.max(layer.borderWidth, 1.2)}" stroke-opacity=".55"/>` : ""));
  }
  // 外轮廓线 + 发光（粗细/强度/颜色；发光用多层描边近似，避免 defs id 冲突）
  if (layer.outlineWidth > 0) {
    const outer = features.map((feature) => `<path d="${feature.d}" fill="none" stroke="${layer.outlineColor}" stroke-width="${layer.outlineWidth}"/>`).join("");
    parts.push(layer.outlineGlow > 0
      ? [3, 2, 1].map((spread) => `<g opacity="${(layer.outlineGlow / 100 * spread / 3).toFixed(2)}">${outer.replaceAll(`stroke-width="${layer.outlineWidth}"`, `stroke-width="${round1(layer.outlineWidth + spread * 2)}" stroke="${layer.glowColor}"`)}</g>`).join("") + outer
      : outer);
  }
  // 区域名称（默认只标注有数据行的区域，「强制显示所有区域名称」全量标注）
  if (layer.showRegionNames) {
    const fontAttrs = nameFontAttrs(layer.nameFont);
    const labels = features.filter((feature) => layer.forceShowNames || rows.some((item) => item.name === feature.name || item.name === feature.nameZh))
      .map((feature) => {
        const [cx, cy] = (() => {
          const [lon, lat] = ringCentroid(largestRing(feature.rings));
          return project(lon, lat);
        })();
        const label = feature.nameZh || feature.name;
        return `<text x="${round1(cx)}" y="${round1(cy)}" text-anchor="middle" font-size="${layer.nameFont.size}" fill="${mixColor(layer.borderColor, "#ffffff", 0.55)}"${fontAttrs}>${label}</text>`;
      }).join("");
    parts.push(`<g class="map-region-names">${labels}</g>`);
  }
  parts.push(breathOverlay(node, project));
  return parts.join("");
}

/** 瓦片地图：内置主题风格化渲染（在线影像类型仅存配置，离线渲染始终用主题矢量）。 */
function tileSvg(node: SceneNode): string | null {
  if (!worldGeo) return null;
  const region = String(node.data?.region ?? "world");
  const themeName = String(node.data?.theme ?? "black-gold");
  const palette = MAP_THEMES[themeName] ?? MAP_THEMES["black-gold"]!;
  const layer = mapLayerConfig(node);
  const projection = String(node.data?.projection ?? "mercator");
  const baseView = REGION_VIEWS[region] ?? REGION_VIEWS.world!;
  const view = { ...baseView, projection: projection === "equirect" ? "equirect" : baseView.projection } as const;
  const project = makeProjector(view, readGroup(node, "tile"));
  const features = (worldGeo.byDataset.get(region) ?? []).map((country) => ({ ...country, d: featurePath(country.rings, project) }));
  if (!features.length) return null;
  const glow = palette.glow ?? palette.border;
  const parts: string[] = [`<rect width="${MAP_VIEW.width}" height="${MAP_VIEW.height}" fill="${palette.ocean}"/>`, graticule(palette.graticule)];
  const dash = layer.borderStyle === "dotted" ? ` stroke-dasharray="2 2.4"` : "";
  // rows 命中的省/州用主题高亮色（对照山海鲸 GIS 卡片的首都高亮）
  const highlightRows = Array.isArray(node.data?.rows) ? node.data!.rows : [];
  const matched = (feature: { name: string; nameZh: string }) =>
    highlightRows.some((row) => !!row && typeof row === "object"
      && ((row as Record<string, unknown>).name === feature.nameZh || (row as Record<string, unknown>).name === feature.name));
  for (const feature of features) {
    // 陆地亮暗分层模拟地形光照：先画整体 land 色，再叠一层提亮南缘（省/州界不叠）
    parts.push(`<path d="${feature.d}" fill="${matched(feature) ? palette.highlight : palette.land}"/>`);
    if (palette.landLight && region === "world") {
      parts.push(`<path d="${feature.d}" fill="${palette.landLight}" fill-opacity=".35" transform="translate(0 1.4)"/>`);
    }
    parts.push(`<path d="${feature.d}" fill="none" stroke="${layer.borderColor || palette.border}" stroke-width="${layer.borderWidth}"${dash}/>` +
      (palette.glow ? `<path d="${feature.d}" fill="none" stroke="${glow}" stroke-width="${round1(layer.borderWidth + 1.2)}" stroke-opacity=".14"/>` : ""));
  }
  if (layer.showRegionNames) {
    const fontAttrs = nameFontAttrs(layer.nameFont);
    const labels = features.map((feature) => {
      const [lon, lat] = ringCentroid(largestRing(feature.rings));
      const [cx, cy] = project(lon, lat);
      if (cx < 8 || cx > MAP_VIEW.width - 8 || cy < 8 || cy > MAP_VIEW.height - 8) return "";
      const label = feature.nameZh || feature.name;
      return `<text x="${round1(cx)}" y="${round1(cy)}" text-anchor="middle" font-size="${layer.nameFont.size}" fill="${palette.label}" fill-opacity=".85"${fontAttrs}>${label}</text>`;
    }).join("");
    parts.push(`<g class="map-region-names">${labels}</g>`);
  }
  parts.push(breathOverlay(node, project));
  return parts.join("");
}

/** 生成地图 SVG 的内层字符串；地理数据未就绪时返回 null，由调用方显示加载占位。 */
export function mapSvg(node: SceneNode): string | null {
  if (!worldGeo) return null;
  const kind = node.widget?.kind;
  if (kind === "mapOutline") return outlineSvg(node);
  if (kind === "mapTile") return tileSvg(node);
  const color = safeColor(node.color);
  const rows = mapRows(node);
  const max = Math.max(...rows.map((row) => row.value), 1);
  const parts: string[] = [`<rect width="${MAP_VIEW.width}" height="${MAP_VIEW.height}" fill="${OCEAN}"/>`, graticule("#ffffff0d")];
  if (kind === "mapRegion") {
    for (const country of worldGeo.countries) {
      if (country.dataset !== "world") continue;
      const row = rows.find((item) => worldGeo!.byName.get(item.name) === country);
      if (row) {
        const t = row.value / max;
        parts.push(`<path d="${country.d}" fill="${color}" fill-opacity="${(0.18 + 0.82 * t).toFixed(2)}" stroke="${BORDER}" stroke-width=".5"/>`);
      } else {
        parts.push(`<path d="${country.d}" fill="${LAND}" stroke="${BORDER}" stroke-width=".5"/>`);
      }
    }
  } else {
    for (const country of worldGeo.countries) {
      if (country.dataset !== "world") continue;
      parts.push(`<path d="${country.d}" fill="${LAND}" stroke="${BORDER}" stroke-width=".5"/>`);
    }
    if (kind === "mapPoint") parts.push(pointsOverlay(rows, max, color));
    if (kind === "mapFlyline") parts.push(flylineOverlay(rows, max, color, (Array.isArray(node.data?.origin) ? node.data!.origin : []) as number[]));
    if (kind === "mapHeat") parts.push(heatOverlay(rows, max, color));
    if (kind === "mapTrack") parts.push(trackOverlay(rows, color));
    if (kind === "mapBar") parts.push(barOverlay(rows, max, color));
  }
  return parts.join("");
}
