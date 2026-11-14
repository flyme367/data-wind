import { modelAssets, panelHiddenModelIds } from "../data/modelCatalog";
import { templates } from "../data/catalog";
import type { NodeType } from "../types";
import { waterPresets, type WaterPreset } from "../data/water";
import { terrainPresets, type TerrainPreset } from "../data/terrain";

/** 3D 编辑素材库分类，与素材 rail 的八个分类一一对应（山海鲸 3D 编辑同款）。
 *  看板组件（图表/文本/媒体/控件）不属于 3D 资产库，归看板模式的素材 rail。 */
export type AssetLibrary =
  | "模型" | "GIS" | "地表" | "标绘" | "材质" | "动效" | "场景";

export interface AssetItem {
  id: string;
  name: string;
  library: AssetLibrary;
  category: string;
  tags: string[];
  type: NodeType | "material" | "scene";
  color: string;
  modelId?: string;
  primitive?: "sphere" | "cylinder" | "cone" | "torus";
  thumbnail?: string;
  triangles?: number;
  aiGenerated?: boolean;
  comingSoon?: boolean;
  templateId?: string;
  terrainPreset?: TerrainPreset;
  waterPreset?: WaterPreset;
  position?: [number, number, number];
  size?: [number, number, number];
  to?: [number, number, number];
}

const C: Record<string, string> = {
  model: "#93A5E8",
  terrain: "#71965A",
  water: "#248FA9",
  marker: "#5B7CFA",
  flyline: "#FF7847",
  fence: "#00C2FF",
  light: "#F7B500",
  camera: "#8E9BC4",
  group: "#8E9BC4",
  material: "#B8C5D6",
  scene: "#79A8EC",
} as const;

function build(): AssetItem[] {
  const hidden = new Set(panelHiddenModelIds);
  const items: AssetItem[] = modelAssets.filter((asset) => !hidden.has(asset.id)).map((asset) => ({
    id: `model-${asset.id}`, modelId: asset.id, name: asset.name,
    library: asset.category.startsWith("GIS") ? "GIS" :
      asset.category.startsWith("地表") || asset.category.startsWith("道路") ? "地表" : "模型",
    category: asset.category, tags: [...asset.category.split(" / "), asset.pack, asset.author,
      ...(asset.category.startsWith("医疗") ? ["医疗设备", "医院"] : []),
      ...(asset.aiGenerated ? ["AI生成"] : [])],
    type: "model", color: "#FFFFFF", thumbnail: asset.thumbnail, triangles: asset.triangles, aiGenerated: asset.aiGenerated,
  }));
  const push = (
    library: AssetLibrary, category: string,
    type: AssetItem["type"],
    presets: (string | (Partial<AssetItem> & { name: string }))[],
    tags: string[] = [],
  ) => {
    for (const value of presets) {
      const preset = typeof value === "string" ? { name: value } : value;
      items.push({
        id: `asset-${library}-${preset.name}`, library, category, type,
        color: C[type], tags: [...category.split(" / "), ...tags], ...preset,
      });
    }
  };
  push("模型", "基础形状", "model", ["立方体",{name:"球体",primitive:"sphere"},{name:"圆柱体",primitive:"cylinder"},{name:"圆锥体",primitive:"cone"},{name:"圆环体",primitive:"torus"}], ["几何", "形状"]);
  push("地表", "地表 / 水体", "water", waterPresets.map((item) => ({
    name: item.name, color: item.color, waterPreset: item.id,
  })), ["水面", "波浪", "水体"]);
  push("地表", "地表 / 地形", "terrain", terrainPresets.map((item) => ({
    name: item.name, color: item.color, terrainPreset: item.id,
  })), ["高度图", "山地", "地形", "地面"]);
  push("GIS", "GIS / 监测点位", "marker", [
    { name: "环境监测站", color: "#53D6A4", position: [-12, 5, -8] },
    { name: "水文监测站", color: "#4BBFFF", position: [12, 4, -8] },
    { name: "视频监控点", color: "#7C8CFF", position: [-12, 8, 8] },
    { name: "人员定位点", color: "#F3C95C", position: [12, 5, 8] },
  ], ["坐标", "监测", "位置"]);
  push("GIS", "GIS / 区域分析", "fence", [
    { name: "规划地块", color: "#4FBCE0", position: [-10, .05, 0], size: [10, .1, 12] },
    { name: "监测覆盖区", color: "#76D9AD", position: [10, .05, 0], size: [12, .1, 12] },
    { name: "保护区边界", color: "#D6BC6F", position: [0, .05, 12], size: [24, .1, 8] },
  ], ["区域", "边界", "范围"]);
  push("GIS", "GIS / 空间连接", "flyline", [
    { name: "城市数据链路", color: "#63B5FF", position: [-15, 3, -10], to: [16, 5, 9] },
    { name: "管网连通关系", color: "#56DDB2", position: [-18, 2, 10], to: [18, 2, -8] },
  ], ["路网", "拓扑", "连接"]);
  // 山海鲸「标绘」三级分类：通用标记/免费标记/智慧园区/智慧城市/大场景标记/智慧管廊/主题标记/浅色系
  push("标绘", "标绘 / 通用标记", "marker", [
    { name: "标记点", color: "#5B9CFF" },
    { name: "告警标记", color: "#FF6C68", position: [-8, 7, -6] },
    { name: "设备标记", color: "#46D7BA", position: [8, 6, -6] },
    { name: "监控标记", color: "#B291F4", position: [-8, 6, 6] },
    { name: "定位光柱", color: "#F4CD69", position: [8, 8, 6] },
  ], ["点位", "光柱"]);
  push("标绘", "标绘 / 智慧园区", "fence", [
    { name: "电子围栏", color: "#00C2FF", size: [14, .1, 10] },
    { name: "禁入区域", color: "#FF6C68", size: [12, .1, 12] },
    { name: "施工区域", color: "#F3C65B", size: [18, .1, 8] },
    { name: "重点保护区域", color: "#56DCA9", size: [16, .1, 16] },
  ], ["边界", "范围"]);
  push("标绘", "标绘 / 智慧城市", "flyline", [
    { name: "飞线", color: "#FF7847" },
    { name: "数据飞线", color: "#4DA8FF", position: [-12, 4, 0], to: [12, 7, 0] },
    { name: "跨区连接", color: "#AD89F5", position: [-12, 3, -12], to: [12, 5, 12] },
  ], ["连线", "流向"]);
  // 山海鲸「材质」三级分类：墙砖/大理石/地砖/水磨石/铺路石/花岗岩（颜色预设按表面用途归组）
  push("材质", "材质 / 墙砖", "material", [
    { name: "混凝土灰", color: "#B8C1C3" }, { name: "金属深灰", color: "#64727C" },
    { name: "冷白", color: "#E0E7EB" }, { name: "陶土红", color: "#C47A62" },
    { name: "警示黄", color: "#F1C34F" }, { name: "科技蓝", color: "#528EF1" },
  ], ["颜色", "表面", "套用"]);
  push("材质", "材质 / 地砖", "material", [
    { name: "砂岩米", color: "#D7C5A2" }, { name: "木棕", color: "#9C7253" },
    { name: "玻璃青", color: "#70BFCA" }, { name: "水蓝", color: "#3D8FC2" },
  ], ["颜色", "表面", "套用"]);
  push("材质", "材质 / 铺路石", "material", [
    { name: "道路黑", color: "#3D454C" }, { name: "草地绿", color: "#65946B" },
  ], ["颜色", "表面", "套用"]);
  push("动效", "动效 / 粒子飞线", "flyline", [
    { name: "能量流", color: "#4DE2CF", position: [-14, 3, 0], to: [14, 3, 0] },
    { name: "数据传输", color: "#4AABFF", position: [0, 3, -14], to: [0, 6, 14] },
    { name: "物流轨迹", color: "#FFAF5C", position: [-14, 2, -8], to: [14, 2, 8] },
    { name: "跨城连线", color: "#D495F4", position: [-18, 3, -12], to: [18, 3, 12] },
    { name: "设备联动", color: "#78DD97", position: [-10, 2, 8], to: [10, 8, -8] },
    { name: "应急调度", color: "#FF7070", position: [-12, 4, -8], to: [12, 4, 8] },
  ], ["动画", "粒子", "流光"]);
  push("动效", "动效 / 悬浮光柱", "marker", [
    { name: "告警光柱", color: "#FF6868", position: [-6, 9, 0] },
    { name: "设备信标", color: "#52D9EB", position: [6, 7, 0] },
  ], ["动画", "悬浮", "标记"]);
  const scenes = [
    ["reference-campus", "智慧园区场景"],
    ["gis-map", "GIS 图层示例"], ["city", "城市建筑群"],
    ["pipes", "工业管道场景"], ["car", "车辆展示场景"], ["floors", "楼层分层场景"],
  ];
  push("场景", "场景 / 组合模板", "scene", scenes.map(([templateId, name]) => ({
    name, templateId, thumbnail: templates.find((template) => template.id === templateId)?.image,
  })), ["组合", "模板", "示例"]);
  // 山海鲸「地表」分类：地形样板归入地表而不是场景
  push("地表", "地表 / 拼接样板", "scene", [["terrain", "地表拼接样板"]].map(([templateId, name]) => ({
    name, templateId, thumbnail: templates.find((template) => template.id === templateId)?.image,
  })), ["地形", "拼接"]);
  // 山海鲸 3D 编辑的分类：灯光/相机归「场景」，地表样板归「地表」；看板组件不进 3D 资产库
  push("场景", "场景 / 灯光", "light", ["聚光灯", "点光源", "平行光"], ["照明"]);
  push("场景", "场景 / 相机", "camera", ["鸟瞰相机", "跟随相机", "漫游相机", "第一人称相机"], ["视角"]);
  return items;
}

const index = build();
const counts = index.reduce<Record<string, number>>((result, item) => {
  result[item.library] = (result[item.library] ?? 0) + 1;
  result["全部"] = (result["全部"] ?? 0) + 1;
  return result;
}, {});

function search(query: string): AssetItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.slice();
  const scored: { item: AssetItem; score: number }[] = [];
  for (const item of index) {
    let score = 0;
    if (item.name.toLowerCase().includes(q)) score += 10;
    if (item.category.toLowerCase().includes(q) || item.library.toLowerCase().includes(q)) score += 5;
    if (item.tags.some((t) => t.toLowerCase().includes(q))) score += 3;
    if (item.type.includes(q)) score += 1;
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

self.onmessage = (e: MessageEvent<{ type: "search"; query: string }>) => {
  if (e.data?.type === "search") {
    (self as unknown as Worker).postMessage({
      type: "searchResult",
      query: e.data.query,
      items: search(e.data.query),
      counts,
    });
  }
};
