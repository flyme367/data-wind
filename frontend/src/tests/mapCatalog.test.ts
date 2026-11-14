import { describe, expect, it } from "vitest";
import { widgetLabels, widgetNode } from "../data/editor";
import { legacyMapCatalog, mapCatalog, mapCategories, mapGroupNodes, mapPaletteNode, usedMapCategories } from "../data/mapCatalog";
import { MAP_THEMES, MAP_VIEW, MAP_THEME_OPTIONS, makeProjector, mapRows, mapSvg, mixColor, projectPoint, worldGeoReady } from "../data/mapSvg";
import { handle } from "../workers/sceneModel";

function mapNode(kind: "mapRegion" | "mapPoint" | "mapFlyline" | "mapHeat" | "mapTrack" | "mapBar" | "mapOutline" | "mapTile") {
  handle({ type: "openProject", projectId: "map-test", tree: [], template: "empty" });
  return handle({ type: "add", node: widgetNode(kind) })!.tree[0]!;
}

describe("山海鲸「地图」组件目录", () => {
  it("1:1 同步山海鲸 16 项：轮廓 6 + 瓦片 7 + 三维 3，chips 与山海鲸一致", () => {
    expect(mapCatalog).toHaveLength(16);
    expect(mapCatalog.filter((entry) => entry.category === "轮廓地图")).toHaveLength(6);
    expect(mapCatalog.filter((entry) => entry.category === "瓦片地图")).toHaveLength(7);
    expect(mapCatalog.filter((entry) => entry.category === "三维地图")).toHaveLength(3);
    expect(mapCatalog.map((entry) => entry.label)).toEqual([
      "中国地图", "世界地图", "美国地图", "自定义地图", "世界地图一", "世界地图二",
      "GIS卫星地图（卫星）", "GIS电子地图（基础）", "GIS地图（黑金）", "GIS地图（蓝黑）", "GIS地图（草绿）", "GIS地图（浅蓝）", "GIS地图（深蓝）",
      "3D GIS底座", "科技风3D地图", "写实风3D地图",
    ]);
    expect(usedMapCategories).toEqual(mapCategories);
    expect(usedMapCategories).toEqual(["全部", "轮廓地图", "瓦片地图", "三维地图"]);
    for (const entry of mapCatalog) {
      expect(widgetLabels[entry.kind]).toBeTruthy();
      expect(entry.image).toMatch(/^\/reference\/map-.+\.webp$/);
    }
  });

  it("旧数据图层六类保留兼容、仅在搜索可见", () => {
    expect(legacyMapCatalog.map((entry) => entry.kind)).toEqual(["mapRegion", "mapPoint", "mapFlyline", "mapHeat", "mapTrack", "mapBar"]);
  });

  it("目录条目数据覆盖：中国地图区域 / GIS黑金主题 / 世界地图一为分组卡", () => {
    expect(mapPaletteNode(mapCatalog[0]!).data).toMatchObject({ region: "china" });
    expect(mapPaletteNode(mapCatalog[8]!)).toMatchObject({ name: "GIS地图（黑金）" });
    expect(mapCatalog[8]!.data).toMatchObject({ theme: "black-gold" });
    expect(mapCatalog.find((entry) => entry.label === "世界地图一")?.group).toBe(true);
    const group = mapGroupNodes(mapCatalog.find((entry) => entry.label === "世界地图一")!);
    expect(group).toHaveLength(2);
    expect(group[0]!.name).toBe("背景");
    expect(group[1]!.name).toBe("世界地图二");
  });

  it("等距圆柱投影覆盖全球画布", () => {
    expect(MAP_VIEW).toMatchObject({ width: 720, height: 360 });
    expect(projectPoint(0, 0)).toEqual([360, 180]);
    expect(projectPoint(180, 90)).toEqual([720, 0]);
    expect(projectPoint(-180, -90)).toEqual([0, 360]);
  });

  it("墨卡托区域投影把中国视野铺满画布", () => {
    const project = makeProjector({ lonMin: 73.4, lonMax: 135.2, latMin: 15.6, latMax: 54.3, projection: "mercator" });
    const [west] = project(73.4, 35);
    const [east] = project(135.2, 35);
    expect(west).toBeLessThanOrEqual(1);
    expect(east).toBeGreaterThanOrEqual(MAP_VIEW.width - 1);
    const [, top] = project(104, 54.3);
    const [, bottom] = project(104, 15.6);
    expect(top).toBeLessThanOrEqual(1);
    expect(bottom).toBeGreaterThanOrEqual(MAP_VIEW.height - 1);
  });

  it("内置主题与瓦片样式下拉一致", () => {
    for (const option of MAP_THEME_OPTIONS) expect(MAP_THEMES[option.value]).toBeTruthy();
    expect(MAP_THEMES["black-gold"]).toMatchObject({ ocean: "#0a0a0c", border: "#c9a227" });
  });

  it("mixColor 与行数据规整", () => {
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("rgb(128,128,128)");
    expect(mixColor("#000", "#fff", 1)).toBe("rgb(255,255,255)");
    const rows = mapRows(mapNode("mapPoint"));
    expect(rows[0]).toMatchObject({ name: "北京", lon: 116.4, lat: 39.9 });
    expect(widgetNode("mapFlyline").data).toMatchObject({ origin: [116.4, 39.9] });
    expect(widgetNode("mapOutline").data).toMatchObject({ region: "china", map: { fillType: "color" }, breath: { shape: "circle" } });
    // GIS 变体默认中国省级视图（对照山海鲸卡片：省界主题配色 + 区域名 + 首都高亮）
    expect(widgetNode("mapTile").data).toMatchObject({ region: "china", theme: "black-gold", tile: { zoom: 1, centerLon: 105 }, rows: [{ name: "北京市" }] });
  });

  it("地理数据未就绪时 mapSvg 返回 null（由调用方显示加载占位）", () => {
    if (worldGeoReady()) return; // 其它用例已触发加载则跳过
    expect(mapSvg(mapNode("mapRegion"))).toBeNull();
  });
});
