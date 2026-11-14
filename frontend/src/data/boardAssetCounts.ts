import { chartCatalog } from "./chartCatalog";
import { textCatalog } from "./textCatalog";
import { controlCatalog } from "./controlCatalog";
import { mediaCatalog } from "./mediaCatalog";
import { mapCatalog } from "./mapCatalog";
import { topologyCatalog } from "./topologyCatalog";
import { kitCatalog } from "./kitCatalog";
import { twinCatalog } from "./catalog";

/** 图表分类包括 3D 图表；3D 分类也提供这些素材入口。 */
export const chartAssetCount = chartCatalog.length;
export const board3dCount = chartCatalog.filter((entry) => entry.category === "3D图表").length + twinCatalog.length;

export const boardAssetCounts: Record<string, number> = {
  "全部": chartAssetCount + board3dCount + textCatalog.length + controlCatalog.length + mediaCatalog.length
    + mapCatalog.length + topologyCatalog.length + kitCatalog.length,
  "图表": chartAssetCount,
  "文本": textCatalog.length,
  "媒体": mediaCatalog.length,
  "控件": controlCatalog.length,
  "地图": mapCatalog.length,
  "3D": board3dCount,
  "拓扑": topologyCatalog.length,
  "套件": kitCatalog.length,
};
