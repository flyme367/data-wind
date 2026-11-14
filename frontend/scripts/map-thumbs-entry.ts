/** 素材缩略图产图页面入口：把 16 个地图主题渲染成独立 SVG 块供 CDP 截图（见 generate-map-thumbs.mjs）。 */
import { mapCatalog, mapPaletteNode } from "../src/data/mapCatalog";
import { loadWorldGeo, mapSvg, worldGeoReady } from "../src/data/mapSvg";
import type { SceneNode } from "../src/types";

/** 自定义地图卡片的示意 GeoJSON（真实组件由用户上传，缩略图只表达「自定义形状」语义）。 */
const CUSTOM_SAMPLE = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "样例区域A" }, geometry: { type: "Polygon", coordinates: [[
      [100, 38], [116, 34], [122, 42], [110, 50], [98, 46], [100, 38]]] } },
    { type: "Feature", properties: { name: "样例区域B" }, geometry: { type: "Polygon", coordinates: [[
      [96, 20], [112, 16], [124, 24], [116, 30], [102, 28], [96, 20]]] } },
    { type: "Feature", properties: { name: "样例区域C" }, geometry: { type: "Polygon", coordinates: [[
      [104, 4], [120, 2], [128, 10], [114, 14], [104, 4]]] } },
  ],
};

export const slugOf = (index: number): string => `map-thumb-${index}`;

async function render(): Promise<void> {
  await loadWorldGeo();
  if (!worldGeoReady()) throw new Error("地理数据加载失败");
  const blocks = mapCatalog.map((entry, index) => {
    const node = mapPaletteNode(entry) as unknown as SceneNode;
    if (entry.data?.region === "custom" && !node.data.geojson) {
      node.data = { ...node.data, geojson: CUSTOM_SAMPLE };
    }
    const svg = mapSvg(node) ?? "";
    return `<div class="thumb" id="${slugOf(index)}" data-label="${entry.label}" data-image="${entry.image}">` +
      `<svg viewBox="0 0 720 360" width="640" height="320" xmlns="http://www.w3.org/2000/svg">${svg}</svg></div>`;
  });
  document.body.innerHTML = blocks.join("");
  document.title = "thumbs-ready";
}
void render();
